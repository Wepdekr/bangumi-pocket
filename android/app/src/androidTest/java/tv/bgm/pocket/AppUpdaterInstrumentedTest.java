package tv.bgm.pocket;

import static org.junit.Assert.*;
import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AppUpdaterInstrumentedTest {
    private JSObject invoke(AppUpdaterPlugin plugin, String method, JSObject data) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<JSObject> value = new AtomicReference<>();
        AtomicReference<String> error = new AtomicReference<>();
        PluginCall call = new PluginCall(null, "AppUpdater", "test", method, data) {
            @Override public void resolve(JSObject result) { value.set(result); done.countDown(); }
            @Override public void reject(String message) { error.set(message); done.countDown(); }
        };
        if (method.equals("download")) plugin.download(call);
        else if (method.equals("cancel")) plugin.cancel(call);
        else if (method.equals("install") || method.equals("installRejected")) plugin.install(call);
        else plugin.getState(call);
        assertTrue("Plugin call timed out: " + method, done.await(15, TimeUnit.SECONDS));
        if (method.equals("installRejected")) { assertNotNull(error.get()); JSObject result = new JSObject(); result.put("rejected", error.get()); return result; }
        assertNull("Plugin rejected: " + error.get(), error.get());
        return value.get();
    }
    @Test public void downloadsRealReleaseVerifiesAndRequestsInstallationWithoutBrowser() throws Exception {
        String version = InstrumentationRegistry.getArguments().getString("updateVersion");
        String url = InstrumentationRegistry.getArguments().getString("updateUrl");
        String sha = InstrumentationRegistry.getArguments().getString("updateSha");
        String size = InstrumentationRegistry.getArguments().getString("updateSize");
        org.junit.Assume.assumeNotNull(version, url, sha, size);
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        IntentFilter settings = new IntentFilter(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        settings.addDataScheme("package");
        Instrumentation.ActivityMonitor settingsMonitor = instrumentation.addMonitor(settings, new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true);
        IntentFilter install = new IntentFilter(Intent.ACTION_VIEW);
        install.addDataScheme("content"); install.addDataType("application/vnd.android.package-archive");
        Instrumentation.ActivityMonitor installMonitor = instrumentation.addMonitor(install, new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true);
        IntentFilter browser = new IntentFilter(Intent.ACTION_VIEW);
        browser.addDataScheme("https");
        Instrumentation.ActivityMonitor browserMonitor = instrumentation.addMonitor(browser, new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null), true);
        Intent launch = new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        MainActivity activity = (MainActivity) instrumentation.startActivitySync(launch);
        AppUpdaterPlugin plugin = (AppUpdaterPlugin) activity.getBridge().getPlugin("AppUpdater").getInstance();
        boolean permissionMode = "permission".equals(InstrumentationRegistry.getArguments().getString("testMode"));
        try {
            if (permissionMode) invoke(plugin, "cancel", new JSObject());
            JSObject metadata = new JSObject();
            metadata.put("version", version);
            metadata.put("url", url);
            metadata.put("size", Long.parseLong(size));
            metadata.put("sha256", sha);
            if (permissionMode) assertEquals("downloading", invoke(plugin, "download", metadata).getString("phase"));
            long deadline = System.currentTimeMillis() + 150000;
            JSObject state;
            do {
                Thread.sleep(1000);
                state = invoke(plugin, "getState", new JSObject());
                assertNotEquals(state.getString("error"), "error", state.getString("phase"));
            } while ((!state.getString("phase").equals("ready") || (permissionMode ? settingsMonitor.getHits() : installMonitor.getHits()) == 0) && System.currentTimeMillis() < deadline);
            assertEquals("ready", state.getString("phase"));
            if (permissionMode) {
                assertTrue("Installation permission settings not requested", settingsMonitor.getHits() > 0);
                assertEquals(0, installMonitor.getHits());
                assertEquals(0, browserMonitor.getHits());
                return;
            }
            assertEquals(0, settingsMonitor.getHits());
            assertEquals(1, installMonitor.getHits());
            assertTrue(invoke(plugin, "getState", new JSObject()).getBool("installerOpened"));
            assertEquals(0, browserMonitor.getHits());
            // A retry reuses the verified package instead of downloading it again.
            invoke(plugin, "install", new JSObject());
            assertEquals(2, installMonitor.getHits());
            // Recheck the file when installation is retried after a permission return.
            java.io.File apk = new java.io.File(activity.getExternalFilesDir(null), "updates/update.apk");
            try (java.io.FileOutputStream out = new java.io.FileOutputStream(apk, true)) { out.write(0); }
            assertTrue(invoke(plugin, "installRejected", new JSObject()).getString("rejected").contains("校验失败"));
            assertEquals("error", invoke(plugin, "getState", new JSObject()).getString("phase"));
            assertEquals(2, installMonitor.getHits());
        } finally {
            if (!permissionMode) invoke(plugin, "cancel", new JSObject());
            instrumentation.removeMonitor(settingsMonitor); instrumentation.removeMonitor(installMonitor); instrumentation.removeMonitor(browserMonitor);
            instrumentation.runOnMainSync(activity::finish);
        }
    }
}
