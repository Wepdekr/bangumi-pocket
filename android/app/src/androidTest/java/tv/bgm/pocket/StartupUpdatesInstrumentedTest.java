package tv.bgm.pocket;

import static org.junit.Assert.*;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class StartupUpdatesInstrumentedTest {
    private String javascript(MainActivity activity, String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            activity.getBridge().getWebView().evaluateJavascript(expression, result -> {value.set(result);done.countDown();}));
        assertTrue(done.await(10, TimeUnit.SECONDS));
        return value.get();
    }
    @Test public void cachedMajorRequirementBlocksTheRealAppAndAndroidBack() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        SharedPreferences preferences = instrumentation.getTargetContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String key = "required-update-v1", previous = preferences.getString(key, null);
        String metadata = "{\"tag_name\":\"v1.0.0\",\"draft\":false,\"prerelease\":false,\"body\":\"测试主版本更新说明\",\"assets\":[{\"name\":\"bangumi-pocket-1.0.0.apk\",\"state\":\"uploaded\",\"size\":4000000,\"digest\":\"sha256:" + "a".repeat(64) + "\",\"browser_download_url\":\"https://github.com/Wepdekr/bangumi-pocket/releases/download/v1.0.0/bangumi-pocket-1.0.0.apk\"}]}";
        assertTrue(preferences.edit().putString(key, metadata).commit());
        MainActivity activity = null;
        try {
            activity = (MainActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            long deadline = System.currentTimeMillis() + 15000;
            while (!"true".equals(javascript(activity, "Boolean(document.querySelector('.update-required'))"))) {
                assertTrue("Startup mandatory dialog missing", System.currentTimeMillis() < deadline);
                Thread.sleep(100);
            }
            assertEquals("true", javascript(activity, "document.getElementById('root').inert"));
            assertEquals("false", javascript(activity, "Array.from(document.querySelectorAll('.update-dialog button')).some(button=>button.textContent.includes('暂不更新') || button.getAttribute('aria-label')==='关闭更新说明')"));
            MainActivity target = activity;
            instrumentation.runOnMainSync(() -> target.getOnBackPressedDispatcher().onBackPressed());
            Thread.sleep(300);
            assertFalse(activity.isFinishing());
            assertEquals("true", javascript(activity, "Boolean(document.querySelector('.update-required')) && document.getElementById('root').inert"));
            javascript(activity, "document.dispatchEvent(new Event('bangumi-update-back')); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
            assertEquals("true", javascript(activity, "Boolean(document.querySelector('.update-required')) && document.getElementById('root').inert"));
        } finally {
            SharedPreferences.Editor restore = preferences.edit();
            if (previous == null) restore.remove(key); else restore.putString(key, previous);
            restore.commit();
            if (activity != null) {MainActivity target=activity;instrumentation.runOnMainSync(target::finish);}
        }
    }
}
