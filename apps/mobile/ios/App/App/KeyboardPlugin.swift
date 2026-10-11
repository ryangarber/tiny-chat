// KeyboardPlugin.swift

import Capacitor
import UIKit

/// Keeps the page still while the software keyboard comes and goes. Left to
/// itself, WKWebView scrolls the whole page up to uncover the focused field,
/// out of step with the keyboard, and only shrinks the visual viewport once
/// the keyboard has settled, so the page overshoots and snaps back. Instead it
/// is told how far the keyboard will cover it and how long that takes, and
/// lays itself out to match.
@objc(KeyboardPlugin)
public final class KeyboardPlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
	public let identifier = "KeyboardPlugin"
	public let jsName = "keyboard"
	public let pluginMethods: [CAPPluginMethod] = []

	override public func load() {
		let center = NotificationCenter.default
		// The notifications WKWebView adjusts its scroll view and viewport on;
		// the same ones @capacitor/keyboard takes from it.
		if let webView {
			for name in [
				UIResponder.keyboardWillShowNotification,
				UIResponder.keyboardWillHideNotification,
				UIResponder.keyboardWillChangeFrameNotification,
				UIResponder.keyboardDidChangeFrameNotification,
			] {
				center.removeObserver(webView, name: name, object: nil)
			}
		}
		center.addObserver(
			self,
			selector: #selector(keyboardWillChangeFrame(_:)),
			name: UIResponder.keyboardWillChangeFrameNotification,
			object: nil
		)
	}

	@MainActor @objc private func keyboardWillChangeFrame(_ notification: Notification) {
		guard
			let webView,
			let info = notification.userInfo,
			let frame = info[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
			let screen = (notification.object as? UIScreen) ?? webView.window?.screen
		else { return }

		let keyboard = webView.convert(frame, from: screen.coordinateSpace)
		let bounds = webView.bounds
		// A floating or undocked keyboard leaves the bottom edge uncovered and
		// the layout alone, as does one moving off screen.
		let docked = keyboard.maxY >= bounds.maxY - 1 && keyboard.intersects(bounds)
		let height = docked ? bounds.maxY - keyboard.minY : 0
		let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0

		notifyListeners("change", data: ["height": height, "duration": duration])
	}
}
