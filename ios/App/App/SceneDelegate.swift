import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.overrideUserInterfaceStyle = .light
        window?.rootViewController = HealthBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

class HealthBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppearancePlugin())
        bridge?.registerPluginInstance(ChatGPTPlanPlugin())
        AppearancePlugin.updateInterface(controller: self)
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        UIApplication.shared.alternateIconName == "AppIconMidnight" ? .lightContent : .darkContent
    }
}

@objc(AppearancePlugin)
public class AppearancePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppearancePlugin"
    public let jsName = "Appearance"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTheme", returnType: CAPPluginReturnPromise)
    ]

    private static let icons: [String: String] = [
        "cherry": "AppIconCherry", "iris": "AppIconIris", "jade": "AppIconJade",
        "lilac": "AppIconLilac", "midnight": "AppIconMidnight", "graphite": "AppIconGraphite"
    ]

    private static var currentTheme: String {
        icons.first(where: { $0.value == UIApplication.shared.alternateIconName })?.key ?? "coral"
    }

    static func updateInterface(controller: CAPBridgeViewController?) {
        let theme = currentTheme
        let colors: [String: UInt32] = [
            "coral": 0xfaf6f3, "cherry": 0xfaf5f7, "iris": 0xf5f6fb, "jade": 0xf3f8f5,
            "lilac": 0xf7f4fa, "midnight": 0x101c30, "graphite": 0xf5f4f1
        ]
        let hex = colors[theme] ?? 0xfaf6f3
        let color = UIColor(red: CGFloat((hex >> 16) & 255) / 255,
                            green: CGFloat((hex >> 8) & 255) / 255,
                            blue: CGFloat(hex & 255) / 255, alpha: 1)
        controller?.view.window?.overrideUserInterfaceStyle = theme == "midnight" ? .dark : .light
        controller?.overrideUserInterfaceStyle = theme == "midnight" ? .dark : .light
        controller?.view.backgroundColor = color
        controller?.webView?.isOpaque = false
        controller?.webView?.backgroundColor = color
        controller?.webView?.scrollView.backgroundColor = color
        controller?.setNeedsStatusBarAppearanceUpdate()
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["supported": UIApplication.shared.supportsAlternateIcons,
                          "theme": Self.currentTheme])
        }
    }

    @objc func setTheme(_ call: CAPPluginCall) {
        guard let theme = call.getString("theme"), theme == "coral" || Self.icons[theme] != nil else {
            call.reject("未知配色")
            return
        }
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                call.reject("当前设备不支持切换桌面图标")
                return
            }
            guard app.applicationState == .active else {
                call.reject("请回到 App 后再切换配色")
                return
            }
            let name = Self.icons[theme]
            if app.alternateIconName == name {
                Self.updateInterface(controller: self.bridge?.viewController as? CAPBridgeViewController)
                call.resolve(["theme": theme])
                return
            }
            app.setAlternateIconName(name) { error in
                DispatchQueue.main.async {
                    if let error = error {
                        call.reject("桌面图标更新失败：\(error.localizedDescription)")
                    } else {
                        Self.updateInterface(controller: self.bridge?.viewController as? CAPBridgeViewController)
                        call.resolve(["theme": theme])
                    }
                }
            }
        }
    }
}
