package tv.bgm.pocket;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;
import java.util.Arrays;

final class UpdateChecks {
    static final long MAX_SIZE = 100L * 1024 * 1024;
    static long parseSize(Object value) {
        if (value instanceof Number) {
            double size = ((Number) value).doubleValue();
            if (Double.isFinite(size) && size > 0 && size <= MAX_SIZE && size == Math.floor(size)) {
                return ((Number) value).longValue();
            }
        }
        throw new IllegalArgumentException("更新信息中的安装包大小无效，请重新检查更新。");
    }
    static void validate(String version, String url, long size, String sha) {
        if (version == null || !version.matches("(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})")
            || !String.format("https://github.com/Wepdekr/bangumi-pocket/releases/download/v%s/bangumi-pocket-%s.apk", version, version).equals(url)
            || size <= 0 || size > MAX_SIZE || sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalArgumentException("更新信息不完整，请重新检查更新。");
        }
    }
    static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] buf = new byte[32768];
            int n;
            while ((n = in.read(buf)) != -1) digest.update(buf, 0, n);
        }
        StringBuilder result = new StringBuilder();
        for (byte b : digest.digest()) result.append(String.format("%02x", b & 255));
        return result.toString();
    }
    static boolean sameSignatures(byte[][] first, byte[][] second) {
        if (first == null || second == null || first.length == 0 || first.length != second.length) return false;
        boolean[] used = new boolean[second.length];
        for (byte[] a : first) {
            boolean found = false;
            for (int i = 0; i < second.length; i++) {
                if (!used[i] && Arrays.equals(a, second[i])) { used[i] = true; found = true; break; }
            }
            if (!found) return false;
        }
        return true;
    }
}
