package com.dermascopeapp

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class ConnectivityModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "ConnectivityModule"
    }

    @ReactMethod
    fun getNetworkStatus(promise: Promise) {
        // Run network check in a background thread to prevent NetworkOnMainThreadException
        thread {
            try {
                val cm = reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
                val network = cm.activeNetwork
                if (network == null) {
                    promise.resolve("NO_NETWORK")
                    return@thread
                }
                val caps = cm.getNetworkCapabilities(network)
                if (caps == null) {
                    promise.resolve("NO_NETWORK")
                    return@thread
                }

                val isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                val isValidated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

                if (isWifi) {
                    if (isValidated) {
                        promise.resolve("WIFI_INTERNET")
                    } else {
                        // Secondary check as recommended: manual HTTP ping to verify
                        if (hasRealInternet()) {
                            promise.resolve("WIFI_INTERNET")
                        } else {
                            promise.resolve("WIFI_NO_INTERNET")
                        }
                    }
                } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                    promise.resolve("CELLULAR_INTERNET")
                } else {
                    promise.resolve("OTHER_NETWORK")
                }
            } catch (e: Exception) {
                promise.reject("FETCH_ERROR", e.localizedMessage)
            }
        }
    }

    private fun hasRealInternet(): Boolean {
        return try {
            val url = URL("https://clients3.google.com/generate_204")
            val conn = url.openConnection() as HttpURLConnection
            conn.connectTimeout = 1500
            conn.readTimeout = 1500
            conn.instanceFollowRedirects = false
            conn.connect()
            val responseCode = conn.responseCode
            conn.disconnect()
            responseCode == 204
        } catch (e: Exception) {
            false
        }
    }
}
