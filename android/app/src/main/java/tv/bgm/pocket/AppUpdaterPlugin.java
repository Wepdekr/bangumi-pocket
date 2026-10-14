package tv.bgm.pocket;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean resumed = true, destroyed = false, opening = false;
    private volatile long downloadID = -1, received = 0, size = 0;
    private volatile String phase = "idle", error = "", version = "", sha = "";
    private volatile boolean autoInstall = false, installerOpened = false, waitingPermission = false;
    private SharedPreferences storage() { return getContext().getSharedPreferences("app_update", Context.MODE_PRIVATE); }
    private DownloadManager manager() { return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE); }
    private File file() { return new File(getContext().getExternalFilesDir(null), "updates/update.apk"); }
    private void persist() {
        storage().edit().putLong("id", downloadID).putLong("size", size).putString("version", version)
            .putString("sha", sha).putString("phase", phase).putString("error", error)
            .putBoolean("auto", autoInstall).putBoolean("opened", installerOpened).putBoolean("permission", waitingPermission).apply();
    }
    private JSObject snapshot() {
        JSObject state = new JSObject();
        state.put("phase", phase); state.put("version", version); state.put("received", received);
        state.put("size", size); state.put("error", error); state.put("installerOpened", installerOpened);
        return state;
    }
    @Override public void load() {
        SharedPreferences p = storage();
        downloadID = p.getLong("id", -1); size = p.getLong("size", 0);
        version = p.getString("version", ""); sha = p.getString("sha", "");
        phase = p.getString("phase", "idle"); error = p.getString("error", "");
        autoInstall = p.getBoolean("auto", false); installerOpened = p.getBoolean("opened", false); waitingPermission = p.getBoolean("permission", false);
        try {
            if (installerOpened && version.equals(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName)) {
                if (downloadID >= 0) manager().remove(downloadID);
                file().delete(); downloadID = -1; phase = "idle"; error = ""; autoInstall = false;
                version = ""; size = 0; installerOpened = false; waitingPermission = false; persist();
            }
        } catch (PackageManager.NameNotFoundException ignored) { }
        // Revalidate a restored file; never rely on a past verification after process death.
        if (phase.equals("ready") || phase.equals("verifying")) phase = "downloading";
        handler.post(tick);
    }
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            worker.execute(() -> {
                try { refresh(); } catch (Exception e) { fail(e.getMessage()); }
                if (phase.equals("ready") && autoInstall && resumed && !opening) {
                    opening = true;
                    try { verify(); handler.post(() -> prompt(null)); }
                    catch (Exception e) { opening = false; fail(e.getMessage()); }
                }
                if (!destroyed) handler.postDelayed(this, 1000);
            });
        }
    };
    private void fail(String message) {
        phase = "error"; error = message == null ? "下载失败，请重试。" : message;
        autoInstall = false; persist();
    }
    private void refresh() throws Exception {
        if (!phase.equals("downloading") || downloadID < 0) return;
        try (Cursor cursor = manager().query(new DownloadManager.Query().setFilterById(downloadID))) {
            if (cursor == null || !cursor.moveToFirst()) { fail("下载任务已移除，请重新下载。"); return; }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            received = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                fail(reason == DownloadManager.ERROR_INSUFFICIENT_SPACE ? "空间不足，请清理后重试。" : "下载失败，请检查网络后重试。");
            } else if (status == DownloadManager.STATUS_SUCCESSFUL) {
                phase = "verifying";
                verify();
                phase = "ready"; received = size; error = ""; persist();
            } else if (status == DownloadManager.STATUS_PAUSED) {
                error = "下载已暂停，网络恢复后会继续。";
            } else error = "";
        }
    }
    @PluginMethod public void getState(PluginCall call) {
        worker.execute(() -> call.resolve(snapshot()));
    }
    @PluginMethod public void download(PluginCall call) {
        worker.execute(() -> {
            try {
                String v = call.getString("version"), url = call.getString("url"), hash = call.getString("sha256");
                // JSON numbers can be Integer, Long or Double after crossing the JS bridge.
                long bytes = UpdateChecks.parseSize(call.getData().opt("size"));
                UpdateChecks.validate(v, url, bytes, hash);
                if (phase.equals("downloading") || phase.equals("verifying") || opening) {
                    call.reject("已有更新任务正在进行。"); return;
                }
                if (downloadID >= 0) manager().remove(downloadID);
                File target = file();
                if ((!target.getParentFile().exists() && !target.getParentFile().mkdirs()) || (target.exists() && !target.delete()))
                    throw new Exception("无法保存安装包，请检查可用空间。");
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("番组口袋 " + v).setDescription("正在下载更新")
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setDestinationInExternalFilesDir(getContext(), null, "updates/update.apk");
                downloadID = manager().enqueue(request);
                version = v; sha = hash; size = bytes; received = 0; phase = "downloading";
                error = ""; autoInstall = true; installerOpened = false; waitingPermission = false; persist();
                call.resolve(snapshot());
            } catch (Exception e) { call.reject(e.getMessage() == null ? "无法开始下载，请重试。" : e.getMessage()); }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        worker.execute(() -> {
            if (opening) { call.reject("请先关闭系统安装界面。"); return; }
            if (downloadID >= 0) manager().remove(downloadID);
            file().delete(); downloadID = -1; phase = "idle"; error = "";
            received = 0; size = 0; version = ""; autoInstall = false; installerOpened = false; waitingPermission = false; persist();
            call.resolve(snapshot());
        });
    }
    private static byte[][] signatures(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null) return null;
        byte[][] result = new byte[signatures.length][];
        for (int i = 0; i < signatures.length; i++) result[i] = signatures[i].toByteArray();
        return result;
    }
    private void verify() throws Exception {
        File apk = file();
        if (!apk.isFile() || apk.length() != size || !UpdateChecks.hash(apk).equalsIgnoreCase(sha))
            throw new Exception("安装包校验失败，请重新下载。");
        PackageManager pm = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo next = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo current = pm.getPackageInfo(getContext().getPackageName(), flags);
        if (next == null || !getContext().getPackageName().equals(next.packageName) || !version.equals(next.versionName)
            || !UpdateChecks.sameSignatures(signatures(current), signatures(next)))
            throw new Exception("安装包与当前应用不匹配，请重新检查更新。");
        long nextCode = Build.VERSION.SDK_INT >= 28 ? next.getLongVersionCode() : next.versionCode;
        long currentCode = Build.VERSION.SDK_INT >= 28 ? current.getLongVersionCode() : current.versionCode;
        if (nextCode < currentCode) throw new Exception("安装包版本过旧，请重新检查更新。");
    }
    @PluginMethod public void install(PluginCall call) {
        worker.execute(() -> {
            if (!phase.equals("ready") || opening) { call.reject("安装包尚未就绪。"); return; }
            opening = true;
            try { verify(); handler.post(() -> prompt(call)); }
            catch (Exception e) { opening = false; fail(e.getMessage()); call.reject(e.getMessage()); }
        });
    }
    private void prompt(PluginCall call) {
        // Downloads may finish in the background; only open system UI while foreground.
        if (!resumed || destroyed) { opening = false; if (call != null) call.reject("请返回应用后安装。"); return; }
        autoInstall = false; persist();
        try {
            if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                error = "请允许番组口袋安装应用，返回后继续安装。"; persist();
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                waitingPermission = true; opening = false; persist();
                getActivity().startActivity(settings);
                if (call != null) call.resolve(snapshot());
                return;
            }
            launchInstaller(call);
        } catch (Exception e) {
            opening = false; error = "无法打开安装界面，请重试。"; persist();
            if (call != null) call.reject(error);
        }
    }
    private void launchInstaller(PluginCall call) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file());
        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().startActivity(intent);
        installerOpened = true; error = ""; opening = false; persist();
        if (call != null) call.resolve(snapshot());
    }
    @Override protected void handleOnResume() {
        resumed = true;
        worker.execute(() -> {
            if (waitingPermission) {
                waitingPermission = false;
                if (Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls()) {
                    autoInstall = true; error = "";
                } else error = "安装权限未开启，可点击安装更新重试。";
                persist();
            }
        });
    }
    @Override protected void handleOnPause() { resumed = false; }
    @Override protected void handleOnDestroy() { destroyed = true; handler.removeCallbacks(tick); worker.shutdown(); }
}
