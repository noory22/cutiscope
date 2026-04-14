package com.dermascopeapp

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import android.util.Log

class AppUpdateModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "AppUpdateModule"
    }

    @ReactMethod
    fun installApk(filePath: String) {
        try {
            val file = File(filePath)
            if (!file.exists()) {
                Log.e("AppUpdateModule", "File does not exist: $filePath")
                return
            }

            val intent = Intent(Intent.ACTION_VIEW)
            val uri: Uri

            // Use FileProvider for secure access
            val authority = reactContext.packageName + ".provider"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                uri = FileProvider.getUriForFile(reactContext, authority, file)
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else {
                uri = Uri.fromFile(file)
            }

            intent.setDataAndType(uri, "application/vnd.android.package-archive")
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            
            if (intent.resolveActivity(reactContext.packageManager) != null) {
                reactContext.startActivity(intent)
            } else {
                Log.e("AppUpdateModule", "No activity found to handle intent")
            }
        } catch (e: Exception) {
            Log.e("AppUpdateModule", "Installation failed", e)
        }
    }
}
