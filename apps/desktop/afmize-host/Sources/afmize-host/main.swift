// Reads one command per line on stdin and writes one reply per line on
// stdout, so the desktop app's main process can use afmize without calling
// into it from another thread:
//
//   {"op":"availability"}                  -> {"op":"availability","json":"..."}
//   {"op":"stream","id":1,"request":"..."} -> {"op":"event","id":1,"event":"..."}, ...
//   {"op":"cancel","id":1}                    (the stream still ends with `finish`)
//
// `request`, `json` and `event` are JSON documents as strings, as afmize takes
// and writes them. Exits when stdin closes.

import Foundation
import Synchronization
import afmize

struct Command: Decodable {
  var op: String
  var id: Int?
  var request: String?
}

let output = Mutex(FileHandle.standardOutput)

func reply(_ object: [String: Any]) {
  guard var data = try? JSONSerialization.data(withJSONObject: object) else { return }
  data.append(0x0A)
  output.withLock { $0.write(data) }
}

let tasks = Mutex<[Int: Task<Void, Never>]>([:])

while let line = readLine(strippingNewline: true) {
  guard let command = try? JSONDecoder().decode(Command.self, from: Data(line.utf8)) else {
    continue
  }
  switch command.op {
  case "availability":
    reply(["op": "availability", "json": Afmize.availabilityJSON()])
  case "stream":
    guard let id = command.id, let request = command.request else { continue }
    // Stored under the lock it is removed under, so a stream that finishes
    // at once cannot be removed before it is added.
    tasks.withLock { running in
      running[id] = Task.detached {
        await Afmize.run(requestJSON: request) { event in
          reply(["op": "event", "id": id, "event": event.jsonString()])
        }
        _ = tasks.withLock { $0.removeValue(forKey: id) }
      }
    }
  case "cancel":
    guard let id = command.id else { continue }
    tasks.withLock { $0[id] }?.cancel()
  default:
    continue
  }
}
