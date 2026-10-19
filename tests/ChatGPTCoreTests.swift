import Foundation

@main struct ChatGPTCoreTests {
    static func main() throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let fixture = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let jwks = fixture["jwks"] as! [String: Any]
        let now = Date(timeIntervalSince1970: 1000)
        let valid = fixture["valid"] as! String
        let claims = try ChatGPTCore.identity(valid, jwks: jwks, clientID: "oaiapp_test", nonce: "test-nonce", now: now)
        precondition(claims["sub"] as? String == "fake-subject")
        func rejects(_ operation: () throws -> Void) { do { try operation(); fatalError("Unexpected success") } catch {} }
        for token in fixture["invalid"] as! [String] {
            rejects { _ = try ChatGPTCore.identity(token, jwks: jwks, clientID: "oaiapp_test", nonce: "test-nonce", now: now) }
        }
        rejects { _ = try ChatGPTCore.identity(valid, jwks: jwks, clientID: "oaiapp_test", subject: "different-subject", now: now) }
        var attempt = try ChatGPTCore.Attempt(port: 1455, clientID: nil, now: now)
        let host = "urn:uuid:12345678-1234-4234-8234-123456789abc"
        let auth = URLComponents(url: attempt.url(hostID: host), resolvingAgainstBaseURL: false)!
        precondition(auth.queryItems!.contains(URLQueryItem(name: "client_id", value: "dynamic_agent_client")))
        func callback(_ state: String, host: String = "127.0.0.1") -> URL { URL(string: "http://\(host):1455/auth/callback?code=fake-code&client_id=oaiapp_test&state=\(state)")! }
        rejects { _ = try attempt.accept(callback("wrong"), now: now) }
        precondition(!attempt.used)
        rejects { _ = try attempt.accept(callback(attempt.state, host: "localhost"), now: now) }
        rejects { _ = try attempt.accept(callback(attempt.state), now: now.addingTimeInterval(601)) }
        rejects { _ = try attempt.accept(URL(string: callback(attempt.state).absoluteString + "&state=duplicate")!, now: now) }
        let result = try attempt.accept(callback(attempt.state), now: now)
        precondition(result.clientID == "oaiapp_test" && result.code == "fake-code")
        rejects { _ = try attempt.accept(callback(attempt.state), now: now) }
        var returning = try ChatGPTCore.Attempt(port: 1455, clientID: "oaiapp_other", now: now)
        rejects { _ = try returning.accept(callback(returning.state), now: now) }
        rejects { try ChatGPTCore.requireScopes("openid email profile") }
        try ChatGPTCore.requireScopes(ChatGPTCore.scopes)
        let meal = try ChatGPTCore.mealInput(photos: ["data:image/jpeg;base64,YQ=="], description: "米饭半碗")
        let content = meal[0]["content"] as! [[String: Any]]
        precondition(content.count == 2 && content[1]["type"] as? String == "input_image")
        precondition(ChatGPTCore.mealNutritionFormat["strict"] as? Bool == true)
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "") }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: " \n ") }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: String(repeating: "饭", count: 401)) }
        let textMeal = try ChatGPTCore.mealInput(photos: [], description: "  米饭半碗、鸡胸肉150克  ")
        let textContent = textMeal[0]["content"] as! [[String: Any]]
        precondition(textContent.count == 1 && textContent[0]["type"] as? String == "input_text")
        precondition((textContent[0]["text"] as! String).hasSuffix("米饭半碗、鸡胸肉150克"))
        let foodReference: [String: Any] = ["id": "oats", "name": "测试燕麦", "aliases": "原味", "note": "干重", "servingAmount": 100, "servingUnit": "g", "kcal": 380, "carbsG": 60, "proteinG": 13, "fatG": 7]
        let referencedMeal = try ChatGPTCore.mealInput(photos: [], description: "测试燕麦50g", foodReferences: [foodReference])
        let referenceText = (referencedMeal[0]["content"] as! [[String: Any]])[0]["text"] as! String
        precondition(referenceText.contains("常吃食物参考") && referenceText.contains("\"servingAmount\":100") && referenceText.contains("\"kcal\":380"))
        precondition(referenceText.contains("\"sodiumMg\":null"))
        let enriched = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference.merging(["sodiumMg": 123.4, "fiberG": 8, "addedSugarsG": 0]) { _, next in next }])
        let enrichedText = (enriched[0]["content"] as! [[String: Any]])[0]["text"] as! String
        precondition(enrichedText.contains("\"sodiumMg\":123.4") && enrichedText.contains("\"addedSugarsG\":0"))
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference.merging(["sodiumMg": true]) { _, next in next }]) }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference.merging(["saturatedFatG": 8]) { _, next in next }]) }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference, foodReference]) }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference.merging(["kcal": true]) { _, next in next }]) }
        rejects { _ = try ChatGPTCore.mealInput(photos: [], description: "燕麦", foodReferences: [foodReference.merging(["servingUnit": "bad"]) { _, next in next }]) }
        rejects { _ = try ChatGPTCore.mealInput(photos: ["https://private.invalid/photo"], description: "") }
        rejects { _ = try ChatGPTCore.mealInput(photos: ["data:image/jpeg;base64,not-valid!"], description: "") }
        rejects { _ = try ChatGPTCore.mealInput(photos: Array(repeating: "data:image/jpeg;base64,YQ==", count: 4), description: "") }
        var stream = ChatGPTCore.Stream()
        try stream.consume("data: {\"type\":\"response.output_text.delta\",\"delta\":\"连接成功\"}\n")
        rejects { _ = try stream.result() }
        try stream.consume("data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n")
        let completed = try stream.result()
        precondition(completed == "连接成功")
        rejects { try stream.consume("data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n") }
        let error = ChatGPTCore.providerError(Data("{\"error\":{\"code\":\"subscription_sharing_user_not_eligible\",\"message\":\"private-secret\"}}".utf8), status: 403)
        precondition(error.code == "PLAN_INELIGIBLE" && !error.localizedDescription.contains("private-secret"))
        var byteStream = ChatGPTCore.Stream()
        let events = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"连接成功\"}\r\n\r\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n"
        for byte in events.utf8 { try byteStream.feed(byte) }
        let byteReply = try byteStream.finish()
        precondition(byteReply == "连接成功")
        var interrupted = ChatGPTCore.Stream()
        for byte in "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n".utf8 { try interrupted.feed(byte) }
        rejects { _ = try interrupted.finish() }
        print("Native identity, callback, scope and completed-stream checks passed")
    }
}
