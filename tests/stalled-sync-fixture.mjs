import { mock } from "./firebase-mock.mjs";

// QA-only network gates. The recovery control is never part of the app build.
export function stallFixtureNetwork() {
  let releaseReads, releaseWrites;
  const reads = new Promise(resolve => { releaseReads = resolve; });
  mock.readGate = () => reads;
  mock.writeGate = new Promise(resolve => { releaseWrites = resolve; });
  const button = document.createElement("button");
  button.textContent = "恢复模拟连接";
  button.style.cssText = "position:fixed;right:12px;bottom:100px;z-index:9999;padding:12px;background:white;border:1px solid #bbb;border-radius:12px";
  button.addEventListener("click", () => {
    mock.readGate = null; mock.writeGate = null;
    releaseReads(); releaseWrites();
    button.disabled = true; button.textContent = "模拟连接已恢复";
  });
  document.body.append(button);
}
