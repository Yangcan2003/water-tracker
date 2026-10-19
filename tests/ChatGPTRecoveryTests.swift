import Foundation

@MainActor final class RecoveryFixture {
    var active = true, revision = 0, begins = 0, ends = 0
    var expire: (() -> Void)?
    var waiter: CheckedContinuation<Void, Error>?
    func background() { active = false; revision += 1 }
    func foreground() { active = true; let saved = waiter; waiter = nil; saved?.resume() }
    func wait() async throws {
        try Task.checkCancellation()
        if active { return }
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in waiter = continuation }
        }, onCancel: { Task { @MainActor in let saved = self.waiter; self.waiter = nil; saved?.resume(throwing: CancellationError()) } })
    }
    func make() -> PlanInferenceRecovery {
        PlanInferenceRecovery(isActive: { self.active }, backgroundRevision: { self.revision }, waitUntilActive: { try await self.wait() }, protect: { expiry in
            self.begins += 1; self.expire = expiry
            return { self.ends += 1; self.expire = nil }
        })
    }
}

@main struct ChatGPTRecoveryTests {
    @MainActor static func until(_ condition: () -> Bool) async {
        for _ in 0..<10000 { if condition() { return }; await Task.yield() }
        fatalError("Recovery did not reach expected state")
    }
    @MainActor static func main() async throws {
        // A complete answer is held without an extra request until foreground.
        let complete = RecoveryFixture(); var sends = 0
        let completed = Task { try await complete.make().run(prepare: { "original request" }, send: { value in sends += 1; complete.background(); return value }) }
        await until { complete.waiter != nil }
        precondition(sends == 1 && complete.ends == 1)
        complete.foreground()
        let answer = try await completed.value
        precondition(answer == "original request" && sends == 1)

        // Expiration cancels only the transfer, then waits instead of spinning
        // or rejecting the original request. The exact payload is reused once.
        let expired = RecoveryFixture(); var inputs: [String] = []
        let resumed = Task { try await expired.make().run(prepare: { "same selected photo and question" }, send: { value in
            inputs.append(value)
            if inputs.count == 1 { try await Task.sleep(nanoseconds: 60_000_000_000) }
            return "recovered"
        }) }
        await until { inputs.count == 1 }
        expired.background(); expired.expire?()
        await until { expired.waiter != nil }
        precondition(inputs.count == 1 && expired.ends == 1)
        expired.foreground()
        let recovered = try await resumed.value
        precondition(recovered == "recovered" && inputs.count == 2 && inputs[0] == inputs[1] && expired.ends == 2)

        // Token preparation must not be cancelled by background expiration.
        let preparing = RecoveryFixture(); var finishPreparation: CheckedContinuation<String, Never>?, preparations = 0, transfers = 0
        let prepared = Task { try await preparing.make().run(prepare: {
            preparations += 1
            if preparations == 1 { return await withCheckedContinuation { finishPreparation = $0 } }
            return "fresh credentials"
        }, send: { value in transfers += 1; return value }) }
        await until { finishPreparation != nil }
        preparing.background(); preparing.expire?(); finishPreparation?.resume(returning: "rotated safely")
        await until { preparing.waiter != nil }
        precondition(transfers == 0)
        preparing.foreground()
        let preparedAnswer = try await prepared.value
        precondition(preparedAnswer == "fresh credentials" && preparations == 2 && transfers == 1)

        // A transport failure can arrive after the app is already foreground.
        let network = RecoveryFixture(); var calls = 0
        let networkResult = try await network.make().run(prepare: { () }, send: { _ in
            calls += 1
            if calls == 1 { network.background(); network.foreground(); throw URLError(.networkConnectionLost) }
            return "ok"
        })
        precondition(networkResult == "ok" && calls == 2)

        // Stopping while suspended cancels the original operation, not a new
        // retry after foreground. No request or background assertion leaks.
        let stopped = RecoveryFixture(); var stoppedCalls = 0
        let cancelled = Task { try await stopped.make().run(prepare: { () }, send: { _ in
            stoppedCalls += 1; stopped.background(); throw URLError(.timedOut)
        }) }
        await until { stopped.waiter != nil }
        cancelled.cancel()
        do { _ = try await cancelled.value; fatalError("Cancelled request succeeded") } catch is CancellationError {}
        stopped.foreground()
        precondition(stoppedCalls == 1 && stopped.ends == 1 && stopped.waiter == nil)

        // Auth/quota failures and ordinary foreground failures are not replayed.
        for error in [ChatGPTCore.fail("quota", "PLAN_LIMIT"), ChatGPTCore.fail("auth", "PLAN_AUTH_REQUIRED")] {
            let fixture = RecoveryFixture(); var count = 0
            do { _ = try await fixture.make().run(prepare: { () }, send: { _ -> String in count += 1; fixture.background(); fixture.foreground(); throw error }); fatalError("Provider error ignored") }
            catch let received as PlanError { precondition(received.code == error.code && count == 1 && fixture.ends == 1) }
        }
        let normal = RecoveryFixture(); var normalCalls = 0
        do { _ = try await normal.make().run(prepare: { () }, send: { _ -> String in normalCalls += 1; throw URLError(.timedOut) }); fatalError("Foreground timeout ignored") }
        catch is URLError { precondition(normalCalls == 1) }

        // Repeated interruptions have a strict retry bound.
        let bounded = RecoveryFixture(); var attempts = 0
        do { _ = try await bounded.make().run(prepare: { () }, send: { _ -> String in attempts += 1; bounded.background(); bounded.foreground(); throw ChatGPTCore.fail("partial", "PLAN_INTERRUPTED") }); fatalError("Retry limit ignored") }
        catch let error as PlanError { precondition(error.code == "PLAN_INTERRUPTED" && attempts == 3 && bounded.begins == bounded.ends) }
        print("Background completion, expiry, resume, credential safety, cancellation and retry-bound checks passed")
    }
}
