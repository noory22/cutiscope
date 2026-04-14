package com.dermascopeapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicBoolean
import com.facebook.react.bridge.LifecycleEventListener
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.app.KeyguardManager
import android.os.PowerManager
import android.view.WindowManager
import android.app.Activity

class SystemPowerModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    private val isReceiverRegistered = AtomicBoolean(false)
    private var isLocking = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.d("SystemPowerModule", "Received intent: ${intent?.action}")
            if (intent?.action == "com.dermascopeapp.POWER_BUTTON_PRESSED") {
                Log.d("SystemPowerModule", "Triggering emitPowerButtonEvent")
                emitPowerButtonEvent(reactContext)
            }
        }
    }

    init {
        registerPowerReceiverIfNeeded()
    }

    override fun getName(): String {
        return "SystemPowerModule"
    }

    override fun initialize() {
        super.initialize()
        reactContext.addLifecycleEventListener(this)
        setupDpmPolicies()
    }

    @ReactMethod
    fun initializeModule() {
        Log.d("SystemPowerModule", "initializeModule() called from JS")
        registerPowerReceiverIfNeeded()
        setupDpmPolicies()
    }

 private fun setupDpmPolicies() {
    try {
        val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(reactContext, KioskDeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(adminComponent)) {
            Log.i("SystemPowerModule", "DPM Admin active")
            // REMOVED: dpm.setMaximumTimeToLock(adminComponent, 0L)
            // This line was forcing immediate lock - removing it keeps kiosk mode without auto-lock
        } else {
            Log.w("SystemPowerModule", "DPM Admin NOT active")
        }
    } catch (e: Exception) {
        Log.e("SystemPowerModule", "Failed to setup DPM policies", e)
    }
}

    @ReactMethod
    fun powerOff() {
        try {
            Log.d("SystemPowerModule", "Executing power off command")
            Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot -p"))
        } catch (e: Exception) {
            Log.e("SystemPowerModule", "Failed to power off: ${e.message}")
        }
    }

    @ReactMethod
    fun restart() {
        try {
            Log.d("SystemPowerModule", "Executing restart command")
            Runtime.getRuntime().exec(arrayOf("su", "-c", "reboot"))
        } catch (e: Exception) {
            Log.e("SystemPowerModule", "Failed to restart: ${e.message}")
        }
    }

    @ReactMethod
    fun lockScreen() {
        val stackTrace = Log.getStackTraceString(Throwable())
        Log.e("SystemPowerModule", "lockScreen() called! Call stack:\n$stackTrace")

        // Prevent multiple lock calls
        if (isLocking) {
            Log.d("SystemPowerModule", "Already locking, skipping")
            return
        }
        
        isLocking = true
        
        try {
            Log.d("SystemPowerModule", "Executing lock screen")
            
            // Get the current activity
            val currentActivity = reactContext.currentActivity
            
            if (currentActivity != null) {
                // Method 1: Use DevicePolicyManager (does NOT minimize app)
                val dpm = reactContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
                val adminComponent = ComponentName(reactContext, KioskDeviceAdminReceiver::class.java)
                
                if (dpm.isAdminActive(adminComponent)) {
                    try {
                        Log.d("SystemPowerModule", "Locking via DevicePolicyManager.lockNow()")
                        dpm.lockNow()
                        Log.i("SystemPowerModule", "Screen locked successfully")
                        return
                    } catch (e: SecurityException) {
                        Log.e("SystemPowerModule", "DPM lock failed: ${e.message}")
                    }
                }
                
                // Method 2: Use KeyguardManager (does NOT minimize app)
                val keyguardManager = reactContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
                
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
                    try {
                        Log.d("SystemPowerModule", "Locking via KeyguardManager")
                        keyguardManager.requestDismissKeyguard(currentActivity, object : KeyguardManager.KeyguardDismissCallback() {
                            override fun onDismissError() {
                                Log.e("SystemPowerModule", "Keyguard dismiss error")
                            }
                            override fun onDismissSucceeded() {
                                Log.d("SystemPowerModule", "Keyguard dismiss succeeded")
                            }
                            override fun onDismissCancelled() {
                                Log.d("SystemPowerModule", "Keyguard dismiss cancelled")
                            }
                        })
                        // Actually lock the screen
                        val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                            try {
                                val method = powerManager.javaClass.getMethod("goToSleep", Long::class.javaPrimitiveType)
                                method.invoke(powerManager, System.currentTimeMillis())
                            } catch (e: Exception) {
                                Log.e("SystemPowerModule", "Go to sleep failed: ${e.message}")
                            }
                        }
                        return
                    } catch (e: Exception) {
                        Log.e("SystemPowerModule", "Keyguard lock failed: ${e.message}")
                    }
                }
                
                // Method 3: Just clear the activity and let system handle (DO NOT minimize)
                Log.d("SystemPowerModule", "Using activity flag to lock")
                currentActivity.moveTaskToBack(false)
            } else {
                Log.w("SystemPowerModule", "No current activity found")
            }
            
        } catch (e: Exception) {
            Log.e("SystemPowerModule", "Failed to lock screen: ${e.message}")
        } finally {
            // Reset locking flag after delay (reduced from 3000ms for responsiveness)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                isLocking = false
            }, 500)
        }
    }

    override fun onHostResume() {
        Log.d("SystemPowerModule", "onHostResume: Resetting isLocking flag")
        isLocking = false
    }

    override fun onHostPause() {
        Log.d("SystemPowerModule", "onHostPause: Resetting isLocking flag")
        isLocking = false
    }

    override fun onHostDestroy() {
        isLocking = false
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Keep React Native happy
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Keep React Native happy
    }

    private fun registerPowerReceiverIfNeeded() {
        if (isReceiverRegistered.getAndSet(true)) return

        try {
            val filter = IntentFilter("com.dermascopeapp.POWER_BUTTON_PRESSED")
            ContextCompat.registerReceiver(
                reactContext,
                receiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            )
            Log.d("SystemPowerModule", "BroadcastReceiver registered for POWER_BUTTON_PRESSED")
        } catch (e: Exception) {
            isReceiverRegistered.set(false)
            Log.e("SystemPowerModule", "Failed to register receiver: ${e.message}")
        }
    }

    companion object {
        fun emitPowerButtonEvent(reactContext: ReactApplicationContext?) {
            try {
                reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    ?.emit("onPowerButtonPressed", null)
                Log.d("SystemPowerModule", "Power button event emitted to React Native")
            } catch (e: Exception) {
                Log.e("SystemPowerModule", "Failed to emit power button event: ${e.message}")
            }
        }
    }
}