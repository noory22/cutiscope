package com.dermascopeapp

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.annotation.TargetApi
import android.content.Intent
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.KeyEvent
import android.util.Log
import android.os.PowerManager
import android.content.Context
import android.app.KeyguardManager

class PowerMenuAccessibilityService : AccessibilityService() {

    companion object {
        var instance: PowerMenuAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d("PowerMenuAccess", "Service connected")
        instance = this
        val info = AccessibilityServiceInfo()
        info.eventTypes = AccessibilityEvent.TYPES_ALL_MASK
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.flags = AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
        this.serviceInfo = info
    }

    override fun onKeyEvent(event: KeyEvent?): Boolean {
        Log.d("PowerMenuAccess", "Key event received: ${event?.keyCode} action: ${event?.action}")
        if (event?.keyCode == KeyEvent.KEYCODE_POWER && event.action == KeyEvent.ACTION_DOWN) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            val isScreenOn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT_WATCH) {
                powerManager.isInteractive
            } else {
                @Suppress("DEPRECATION")
                powerManager.isScreenOn
            }

            if (isScreenOn) {
                val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                val isLocked = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                    keyguardManager.isDeviceLocked
                } else {
                    keyguardManager.isKeyguardLocked
                }

                if (!isLocked) {
                    Log.d("PowerMenuAccess", "Power button DOWN detected, screen ON, and device NOT locked")
                    val intent = Intent(this, MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    }
                    startActivity(intent)
                    return true
                } else {
                    Log.d("PowerMenuAccess", "Device is locked, skipping")
                }
            } else {
                @Suppress("DEPRECATION")
                Log.d("PowerMenuAccess", "Power button DOWN detected but screen is OFF, skipping")
            }
        }
        return super.onKeyEvent(event)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    fun lockScreen(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            Log.d("PowerMenuAccess", "Performing GLOBAL_ACTION_LOCK_SCREEN")
            performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
        } else {
            Log.w("PowerMenuAccess", "GLOBAL_ACTION_LOCK_SCREEN not supported on this API level (${Build.VERSION.SDK_INT})")
            false
        }
    }
}
