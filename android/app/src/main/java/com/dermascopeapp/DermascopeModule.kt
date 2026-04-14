package com.dermascopeapp

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DermascopeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "DermascopeModule"
    }

    @ReactMethod
    fun setPolarization(active: Boolean, mode: Int) {
        val activity = getCurrentActivity()
        if (activity is MainActivity) {
            activity.runOnUiThread {
                activity.setPolarizationFromJS(active, mode)
            }
        }
    }

    @ReactMethod
    fun getPolarizationState(promise: com.facebook.react.bridge.Promise) {
        val activity = getCurrentActivity()
        if (activity is MainActivity) {
            val state = activity.getPolarizationStateFromJS()
            val map = com.facebook.react.bridge.Arguments.createMap()
            map.putBoolean("active", state.getBoolean("active"))
            map.putInt("mode", state.getInt("mode"))
            map.putString("modeName", state.getString("modeName"))
            promise.resolve(map)
        } else {
            promise.reject("ACTIVITY_NOT_AVAILABLE", "Activity not available")
        }
    }
}
