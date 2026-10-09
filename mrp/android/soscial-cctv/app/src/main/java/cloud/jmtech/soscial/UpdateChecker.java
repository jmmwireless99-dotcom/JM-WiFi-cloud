package cloud.jmtech.soscial;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Polls VPS /api/soscial/update and installs a newer APK when versionCode increases.
 */
public final class UpdateChecker {
    private static final String TAG = "SoscialUpdate";
    public static final String UPDATE_URL = "https://jmtechsolution.cloud/api/soscial/update";

    private final Activity activity;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private long downloadId = -1;
    private BroadcastReceiver downloadReceiver;
    private boolean prompted;

    public UpdateChecker(Activity activity) {
        this.activity = activity;
    }

    public void checkAsync() {
        io.execute(() -> {
            try {
                JSONObject json = fetchJson(UPDATE_URL);
                int remoteCode = json.optInt("versionCode", 0);
                String remoteName = json.optString("versionName", "");
                String notes = json.optString("notes", "");
                String apkUrl = json.optString("apkUrl", "https://jmtechsolution.cloud/soscial.apk");
                int localCode = localVersionCode();
                Log.i(TAG, "local=" + localCode + " remote=" + remoteCode + " " + remoteName);
                if (remoteCode > localCode && !prompted) {
                    prompted = true;
                    String msg = "May bagong SOCIAL Park CCTV (v" + remoteName + ").\n"
                            + (notes.isEmpty() ? "I-update para makita ang bagong cameras mula sa VPS." : notes);
                    main.post(() -> showUpdateDialog(msg, apkUrl, remoteName));
                }
            } catch (Exception e) {
                Log.w(TAG, "update check failed: " + e.getMessage());
            }
        });
    }

    private int localVersionCode() {
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                return (int) activity.getPackageManager()
                        .getPackageInfo(activity.getPackageName(), 0).getLongVersionCode();
            }
            return activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    private static JSONObject fetchJson(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("Accept", "application/json");
        try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return new JSONObject(sb.toString());
        } finally {
            conn.disconnect();
        }
    }

    private void showUpdateDialog(String message, String apkUrl, String versionName) {
        if (activity.isFinishing()) return;
        new AlertDialog.Builder(activity)
                .setTitle("Update available")
                .setMessage(message)
                .setCancelable(true)
                .setNegativeButton("Later", null)
                .setPositiveButton("Update now", (d, w) -> startDownload(apkUrl, versionName))
                .show();
    }

    private void startDownload(String apkUrl, String versionName) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(activity, "Payagan muna ang Install unknown apps", Toast.LENGTH_LONG).show();
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(i);
            } catch (Exception ignored) {
            }
        }

        try {
            DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            Uri uri = Uri.parse(apkUrl + (apkUrl.contains("?") ? "&" : "?") + "v=" + Uri.encode(versionName));
            DownloadManager.Request req = new DownloadManager.Request(uri);
            req.setTitle("SOCIAL Park CCTV " + versionName);
            req.setDescription("Downloading update…");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS,
                    "soscial-park-cctv-" + versionName + ".apk");
            req.setMimeType("application/vnd.android.package-archive");
            registerReceiver();
            downloadId = dm.enqueue(req);
            Toast.makeText(activity, "Downloading update…", Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Log.e(TAG, "download failed", e);
            // Fallback: open browser
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)));
            } catch (Exception ignored) {
            }
        }
    }

    private void registerReceiver() {
        if (downloadReceiver != null) return;
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                installDownloaded(id);
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            activity.registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            activity.registerReceiver(downloadReceiver, filter);
        }
    }

    private void installDownloaded(long id) {
        DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        try {
            Uri downloaded = dm.getUriForDownloadedFile(id);
            if (downloaded != null) {
                installApk(downloaded);
                return;
            }
        } catch (Exception e) {
            Log.w(TAG, "getUriForDownloadedFile: " + e.getMessage());
        }
        DownloadManager.Query q = new DownloadManager.Query();
        q.setFilterById(id);
        try (Cursor c = dm.query(q)) {
            if (c != null && c.moveToFirst()) {
                int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                if (statusIdx >= 0 && c.getInt(statusIdx) == DownloadManager.STATUS_SUCCESSFUL && uriIdx >= 0) {
                    String localUri = c.getString(uriIdx);
                    if (localUri != null) installApk(Uri.parse(localUri));
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "install query failed", e);
        }
    }

    private void installApk(Uri downloaded) {
        try {
            Uri contentUri = downloaded;
            if ("file".equals(downloaded.getScheme())) {
                File file = new File(downloaded.getPath());
                contentUri = FileProvider.getUriForFile(
                        activity,
                        activity.getPackageName() + ".fileprovider",
                        file);
            }
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "install intent failed", e);
            Toast.makeText(activity, "Download OK — buksan ang APK sa Notifications", Toast.LENGTH_LONG).show();
        }
    }

    public void destroy() {
        if (downloadReceiver != null) {
            try {
                activity.unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            downloadReceiver = null;
        }
        io.shutdownNow();
    }
}
