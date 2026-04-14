package com.dermascopeapp;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.io.DataOutputStream;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class SystemTimeModule extends ReactContextBaseJavaModule {

    SystemTimeModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return "SystemTimeModule";
    }

    @ReactMethod
    public void setTime(double timestamp) {
        try {
            // Convert timestamp (milliseconds) to Date
            Date date = new Date((long) timestamp);
            
            // Format date for 'date' command: MMddHHmmYYYY.ss
            SimpleDateFormat sdf = new SimpleDateFormat("MMddHHmmyyyy.ss", Locale.US);
            String formattedDate = sdf.format(date);
            
            // Execute date setting command as root
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            
            // Note: Different Android versions/devices might have slightly different date formats for the command.
            // Standard toolbox date command often accepts MMDDhhmm[[CC]YY][.ss]
            // We are sending: date MMDDhhmmYYYY.ss
            os.writeBytes("date " + formattedDate + "\n");
            // Broadcast TIME_SET to trigger immediate system UI update (Status Bar, etc.)
            os.writeBytes("am broadcast -a android.intent.action.TIME_SET\n");
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();
        } catch (IOException | InterruptedException e) {
            e.printStackTrace();
        }
    }
    @ReactMethod
    public void grantPermissions(com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            
            String packageName = "com.dermascopeapp";
            String[] permissions = {
                "android.permission.CAMERA",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
                "android.permission.READ_MEDIA_IMAGES",
                "android.permission.ACCESS_FINE_LOCATION",
                "android.permission.ACCESS_COARSE_LOCATION"
            };

            // 1. Grant standard permissions
            for (String perm : permissions) {
                os.writeBytes("pm grant " + packageName + " " + perm + "\n");
            }
            
            // 2. Grant MANAGE_EXTERNAL_STORAGE for Android 11+ (API 30+)
            // This provides "All Files Access" which bypasses scoped storage restrictions
            os.writeBytes("appops set " + packageName + " MANAGE_EXTERNAL_STORAGE allow\n");
            
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            process.waitFor();
            
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("GRANT_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToWifi(String ssid, String password, String securityType, com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            
            // Format: cmd wifi connect-network <ssid> <security_type> <password>
            // securityType should be "open", "wpa2", or "wpa3" (we can map "Secured" to "wpa2" as default)
            
            String cmdAuth = "open";
            if (password != null && !password.isEmpty()) {
                cmdAuth = "wpa2"; // Defaulting to WPA2 for secured networks
            }
            
            // Wrap SSID in quotes if it has spaces, but usually cmd wifi handles raw args if carefully passed.
            // However, shell argument parsing is tricky. Best to quote.
            String safeSsid = "\"" + ssid + "\"";
            String safePassword = "\"" + password + "\"";
            
            if (cmdAuth.equals("open")) {
                 os.writeBytes("cmd wifi connect-network " + safeSsid + " open\n");
            } else {
                 // For secured networks, forget the network first to ensure fresh authentication
                 forgetNetworkInternal(ssid);
                 os.writeBytes("cmd wifi connect-network " + safeSsid + " " + cmdAuth + " " + safePassword + "\n");
            }
            
            os.writeBytes("exit\n");
            os.flush();
            os.close();
            
            int exitCode = process.waitFor();
            
            if (exitCode == 0) {
                promise.resolve(true);
            } else {
                promise.reject("CONNECTION_FAILED", "Root command failed with exit code " + exitCode);
            }
        } catch (Exception e) {
             promise.reject("CONNECTION_ERROR", e.getMessage());
        }
    }

    private void forgetNetworkInternal(String ssid) {
        try {
            // 1. List networks
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            java.io.InputStream is = process.getInputStream();
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is));

            os.writeBytes("cmd wifi list-networks\n");
            os.writeBytes("exit\n");
            os.flush();

            String line;
            String networkId = null;

            // 2. Parse output to find Network ID
            while ((line = reader.readLine()) != null) {
                if (line.contains(ssid)) {
                     String[] parts = line.trim().split("\\s+");
                     if (parts.length > 0) {
                         // Check if this line actually matches the SSID
                         if (line.contains("\"" + ssid + "\"") || line.contains(ssid)) {
                             networkId = parts[0];
                             break;
                         }
                     }
                }
            }
            
            os.close();
            process.waitFor();
            
            // 3. Forget network if found
            if (networkId != null) {
                 Process forgetProc = Runtime.getRuntime().exec("su");
                 DataOutputStream forgetOs = new DataOutputStream(forgetProc.getOutputStream());
                 forgetOs.writeBytes("cmd wifi forget-network " + networkId + "\n");
                 forgetOs.writeBytes("exit\n");
                 forgetOs.flush();
                 forgetOs.close();
                 forgetProc.waitFor();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @ReactMethod
    public void forgetNetwork(String ssid, com.facebook.react.bridge.Promise promise) {
         try {
            forgetNetworkInternal(ssid);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("FORGET_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void deleteFileRoot(String filePath, com.facebook.react.bridge.Promise promise) {
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());

            String safePath = "\"" + filePath + "\"";

            // 1. Delete the file forcefully
            os.writeBytes("rm -f " + safePath + "\n");

            // 2. Broadcast to MediaScanner to remove it from Gallery apps immediately
            // Note: Since Android 4.4, ACTION_MEDIA_MOUNTED is deprecated/restricted, 
            // but ACTION_MEDIA_SCANNER_SCAN_FILE works for specific files.
            // We use 'am broadcast' to trigger this intent.
            // The data uri must be file:///path/to/file
            String uri = "file://" + filePath;
            os.writeBytes("am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d " + "\"" + uri + "\"\n");

            os.writeBytes("exit\n");
            os.flush();
            os.close();

            int exitCode = process.waitFor();

            if (exitCode == 0) {
                promise.resolve(true);
            } else {
                promise.reject("DELETE_FAILED", "Root delete failed with exit code " + exitCode);
            }
        } catch (Exception e) {
            promise.reject("DELETE_ERROR", e.getMessage());
        }
    }
}
