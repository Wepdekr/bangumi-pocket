package tv.bgm.pocket;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "AccountVault")
public class AccountVaultPlugin extends Plugin {
    private static final String ALIAS = "bangumi-pocket-account-v1";
    private SharedPreferences storage() {
        return getContext().getSharedPreferences("account_vault", Context.MODE_PRIVATE);
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 16384) { call.reject("Invalid session"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            String encrypted = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!storage().edit().putString("iv", iv).putString("session", encrypted).commit()) {
                call.reject("Cannot save session"); return;
            }
            call.resolve();
        } catch (Exception ignored) { call.reject("Cannot encrypt session"); }
    }
    @PluginMethod
    public void get(PluginCall call) {
        String encrypted = storage().getString("session", null);
        JSObject result = new JSObject();
        if (encrypted == null) { result.put("value", org.json.JSONObject.NULL); call.resolve(result); return; }
        try {
            String iv = storage().getString("iv", null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            result.put("value", new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8));
            call.resolve(result);
        } catch (Exception ignored) { call.reject("Cannot decrypt session; reconnect account"); }
    }
    @PluginMethod
    public void clear(PluginCall call) {
        if (storage().edit().clear().commit()) call.resolve(); else call.reject("Cannot clear session");
    }
}
