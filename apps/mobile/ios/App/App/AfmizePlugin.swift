// AfmizePlugin.swift

import Capacitor
import Foundation
import Synchronization
import afmize

@objc(AfmizePlugin)
public final class AfmizePlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
	public let identifier = "AfmizePlugin"
	public let jsName = "afmize"

	public let pluginMethods: [CAPPluginMethod] = [
		CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "stream", returnType: CAPPluginReturnPromise),
		CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
	]

	private let tasks = Mutex<[Int: Task<Void, Never>]>([:])
	private let nextID = Atomic<Int>(0)

	@objc func availability(_ call: CAPPluginCall) {
		call.resolve(["json": Afmize.availabilityJSON()])
	}

	@objc func stream(_ call: CAPPluginCall) {
		guard let key = call.getInt("key"), let request = call.getString("request") else {
			call.reject("stream takes a numeric `key` and a `request` JSON string")
			return
		}
		let id = nextID.wrappingAdd(1, ordering: .relaxed).newValue

		// Stored under the lock it is removed under, so a stream that finishes
		// at once cannot be removed before it is added.
		tasks.withLock { tasks in
			tasks[id] = Task.detached { [weak self] in
				// Events come serially, `stream-start` first and `finish` last,
				// even on cancel or a request afmize can't decode.
				let _self = self;
				await Afmize.run(requestJSON: request) { event in
					_self?.notifyListeners("event", data: ["key": key, "event": event.jsonString()])
				}
				_ = self?.tasks.withLock { $0.removeValue(forKey: id) }
			}
		}
		call.resolve(["id": id])
	}

	@objc func cancel(_ call: CAPPluginCall) {
		guard let id = call.getInt("id") else {
			call.reject("cancel takes the `id` stream resolved with")
			return
		}
		// afmize still sends `finish` (reason "other") for a cancelled stream.
		tasks.withLock { $0[id] }?.cancel()
		call.resolve()
	}
}
