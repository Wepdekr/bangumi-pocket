package tv.bgm.pocket;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.File;
import java.nio.file.Files;

public class UpdateChecksTest {
    private final String sha = "a".repeat(64);
    private final String url = "https://github.com/Wepdekr/bangumi-pocket/releases/download/v1.2.3/bangumi-pocket-1.2.3.apk";
    @Test public void acceptsOnlyOurVersionedApkAndBoundedSize() {
        UpdateChecks.validate("1.2.3", url, 4000000, sha);
        String[] invalid = {"http" + url.substring(5), url + "?token=secret", url.replace("Wepdekr", "other"), url + "#x", "file:///tmp/a.apk"};
        for (String value : invalid) assertThrows(IllegalArgumentException.class, () -> UpdateChecks.validate("1.2.3", value, 4000000, sha));
        assertThrows(IllegalArgumentException.class, () -> UpdateChecks.validate("1.2.3", url, -1, sha));
        assertThrows(IllegalArgumentException.class, () -> UpdateChecks.validate("1.2.3", url, UpdateChecks.MAX_SIZE + 1, sha));
        assertThrows(IllegalArgumentException.class, () -> UpdateChecks.validate("1.2.3", url, 4, "bad"));
        assertThrows(IllegalArgumentException.class, () -> UpdateChecks.validate("01.2.3", url, 4, sha));
    }
    @Test public void hashesExactBytesAndDetectsCorruption() throws Exception {
        File file = File.createTempFile("apk-check", ".apk");
        try {
            Files.write(file.toPath(), new byte[] {97, 98, 99});
            assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", UpdateChecks.hash(file));
            Files.write(file.toPath(), new byte[] {97, 98, 100});
            assertNotEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", UpdateChecks.hash(file));
        } finally { file.delete(); }
    }
    @Test public void requiresMatchingNonemptySignerSets() {
        byte[][] first = {{1,2},{3,4}}, reversed = {{3,4},{1,2}};
        assertTrue(UpdateChecks.sameSignatures(first, reversed));
        assertFalse(UpdateChecks.sameSignatures(first, new byte[][] {{1,2},{9,9}}));
        assertFalse(UpdateChecks.sameSignatures(first, new byte[][] {{1,2}}));
        assertFalse(UpdateChecks.sameSignatures(null, reversed));
        assertFalse(UpdateChecks.sameSignatures(new byte[0][], new byte[0][]));
    }
}
