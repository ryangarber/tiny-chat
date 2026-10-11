//
//  ViewController.swift
//  App
//
//  Created by Ryan on 10/11/2026.
//

import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
	override open func capacitorDidLoad() {
		bridge?.registerPluginInstance(AfmizePlugin());
		bridge?.registerPluginInstance(KeyboardPlugin());
	}
}
