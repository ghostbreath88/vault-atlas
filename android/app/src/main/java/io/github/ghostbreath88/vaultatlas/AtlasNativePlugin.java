package io.github.ghostbreath88.vaultatlas;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/**
 * Native helpers for Vault Atlas.
 *
 * Folder access is READ-ONLY: the app only ever asks Android for FLAG_GRANT_READ_URI_PERMISSION on the
 * folder you pick, and this class never opens a vault document for writing. The only write it performs
 * is saveFile(), which writes a NEW file you name yourself in the system "Save" dialog (app-data export).
 */
@CapacitorPlugin(name = "AtlasNative")
public class AtlasNativePlugin extends Plugin {
    private static final String PREFS = "atlas_folder";
    private static final String KEY_TREE = "tree";
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private ContentResolver cr() { return getContext().getContentResolver(); }

    /* ------------------------------------------------------------------ info */

    @PluginMethod
    public void info(PluginCall call) {
        JSObject r = new JSObject();
        Context c = getContext();
        r.put("internetPermission", c.checkSelfPermission(Manifest.permission.INTERNET) == PackageManager.PERMISSION_GRANTED);
        r.put("blockedRequests", LocalOnlyWebViewClient.blocked.get());
        r.put("sdk", Build.VERSION.SDK_INT);
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            r.put("versionName", pi.versionName);
            r.put("versionCode", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (PackageManager.NameNotFoundException ignored) { }
        r.put("obsidianInstalled", obsidianInstalled());
        call.resolve(r);
    }

    private boolean obsidianInstalled() {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("obsidian://open"));
        return i.resolveActivity(getContext().getPackageManager()) != null;
    }

    /* ------------------------------------------------------- folder access */

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        String initial = call.getString("initialUri");
        if (initial == null) initial = prefs().getString(KEY_TREE, null);
        if (initial != null && Build.VERSION.SDK_INT >= 26) {
            try { i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(initial)); } catch (Exception ignored) { }
        }
        startActivityForResult(call, i, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject r = new JSObject();
            r.put("cancelled", true);
            call.resolve(r);
            return;
        }
        Uri tree = data.getData();
        try {
            cr().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Android didn't allow lasting access to that folder.", "NO_PERSIST", e);
            return;
        }
        String prev = prefs().getString(KEY_TREE, null);
        if (prev != null && !prev.equals(tree.toString())) {
            try { cr().releasePersistableUriPermission(Uri.parse(prev), Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
        }
        prefs().edit().putString(KEY_TREE, tree.toString()).apply();
        call.resolve(status(tree));
    }

    private Uri savedTree() {
        String s = prefs().getString(KEY_TREE, null);
        return s == null ? null : Uri.parse(s);
    }

    private boolean hasPersistedRead(Uri tree) {
        for (UriPermission p : cr().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission()) return true;
        }
        return false;
    }

    private JSObject status(Uri tree) {
        JSObject r = new JSObject();
        r.put("connected", tree != null);
        if (tree == null) return r;
        r.put("uri", tree.toString());
        boolean perm = hasPersistedRead(tree);
        r.put("permission", perm);
        String name = null;
        boolean accessible = false;
        String reason = null;
        if (!perm) reason = "permission-revoked";
        else {
            Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = cr().query(root, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) { name = c.getString(0); accessible = true; }
                else reason = "not-found";
            } catch (SecurityException e) { reason = "permission-revoked"; }
            catch (Exception e) { reason = "not-found"; }
        }
        r.put("accessible", accessible);
        if (name != null) r.put("name", name);
        if (reason != null) r.put("reason", reason);
        return r;
    }

    @PluginMethod
    public void folderStatus(PluginCall call) { call.resolve(status(savedTree())); }

    @PluginMethod
    public void disconnectFolder(PluginCall call) {
        Uri tree = savedTree();
        if (tree != null) {
            try { cr().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) { }
        }
        prefs().edit().remove(KEY_TREE).apply();
        call.resolve(status(null));
    }

    /** Recursively lists the connected folder. Hidden folders (".obsidian", ".trash", ...) are reported but not entered. */
    @PluginMethod
    public void listFolder(PluginCall call) {
        final Uri tree = savedTree();
        if (tree == null) { call.reject("No folder connected", "NO_FOLDER"); return; }
        io.execute(() -> {
            try {
                if (!hasPersistedRead(tree)) { call.reject("Folder access was removed", "NO_ACCESS"); return; }
                JSArray files = new JSArray();
                JSArray hidden = new JSArray();
                ArrayDeque<String[]> queue = new ArrayDeque<>();
                queue.add(new String[]{DocumentsContract.getTreeDocumentId(tree), ""});
                String[] cols = {
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
                    DocumentsContract.Document.COLUMN_LAST_MODIFIED };
                boolean first = true;
                while (!queue.isEmpty()) {
                    String[] dir = queue.poll();
                    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir[0]);
                    try (Cursor c = cr().query(children, cols, null, null, null)) {
                        if (c == null) { if (first) { call.reject("The folder could not be opened", "NOT_FOUND"); return; } continue; }
                        while (c.moveToNext()) {
                            String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                            long size = c.isNull(3) ? 0 : c.getLong(3), mtime = c.isNull(4) ? 0 : c.getLong(4);
                            String path = dir[1].isEmpty() ? name : dir[1] + "/" + name;
                            boolean isDir = DocumentsContract.Document.MIME_TYPE_DIR.equals(mime);
                            if (name.startsWith(".")) {
                                JSObject h = new JSObject(); h.put("path", path); h.put("dir", isDir); h.put("size", size); hidden.put(h);
                                continue;
                            }
                            if (isDir) { queue.add(new String[]{id, path}); continue; }
                            JSObject f = new JSObject();
                            f.put("path", path); f.put("id", id); f.put("size", size); f.put("mtime", mtime);
                            files.put(f);
                        }
                    }
                    first = false;
                }
                JSObject r = status(tree);
                r.put("files", files);
                r.put("hidden", hidden);
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject("Folder access was removed", "NO_ACCESS");
            } catch (Exception e) {
                call.reject("Could not list the folder: " + e.getMessage(), "LIST_FAILED");
            }
        });
    }

    /** Reads a batch of documents (by document id) and returns them base64-encoded. Read-only. */
    @PluginMethod
    public void readFiles(PluginCall call) {
        final Uri tree = savedTree();
        final JSArray ids = call.getArray("ids");
        if (tree == null || ids == null) { call.reject("No folder connected", "NO_FOLDER"); return; }
        io.execute(() -> {
            JSArray out = new JSArray();
            byte[] buf = new byte[65536];
            for (int i = 0; i < ids.length(); i++) {
                JSObject o = new JSObject();
                String id;
                try { id = ids.getString(i); } catch (JSONException e) { continue; }
                o.put("id", id);
                Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
                try (InputStream in = cr().openInputStream(doc)) {
                    if (in == null) throw new FileNotFoundException("unreadable");
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    o.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                } catch (SecurityException e) {
                    o.put("error", "Access denied");
                } catch (FileNotFoundException e) {
                    o.put("error", "File no longer exists");
                } catch (Exception e) {
                    o.put("error", e.getMessage() == null ? e.toString() : e.getMessage());
                }
                out.put(o);
            }
            JSObject r = new JSObject();
            r.put("files", out);
            call.resolve(r);
        });
    }

    /* ------------------------------------------------ export (new file only) */

    @PluginMethod
    public void saveFile(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "vault-atlas-app-data.json"));
        startActivityForResult(call, i, "onSaveTarget");
    }

    @ActivityCallback
    private void onSaveTarget(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject r = new JSObject(); r.put("cancelled", true); call.resolve(r); return;
        }
        final Uri target = data.getData();
        final String b64 = call.getString("data", "");
        io.execute(() -> {
            try (OutputStream os = cr().openOutputStream(target, "wt")) {
                if (os == null) throw new FileNotFoundException("cannot write");
                os.write(Base64.decode(b64, Base64.DEFAULT));
                JSObject r = new JSObject(); r.put("saved", true); call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not save the file: " + e.getMessage(), "SAVE_FAILED");
            }
        });
    }

    /* ------------------------------------------------------- hand-offs */

    /** Opens obsidian:// (exact note), or an http(s)/mailto link the user tapped, in another app. */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String s = call.getString("uri", "");
        Uri u = Uri.parse(s);
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if (!(scheme.equals("obsidian") || scheme.equals("https") || scheme.equals("http") || scheme.equals("mailto"))) {
            call.reject("Unsupported link type", "BAD_SCHEME");
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW, u);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        JSObject r = new JSObject();
        try {
            getContext().startActivity(i);
            r.put("opened", true);
        } catch (ActivityNotFoundException e) {
            r.put("opened", false);
            r.put("reason", scheme.equals("obsidian") ? "obsidian-not-installed" : "no-app");
        }
        call.resolve(r);
    }

    /** Hands one attachment (e.g. a PDF) to a viewer app via a temporary private cache copy. */
    @PluginMethod
    public void openAttachment(PluginCall call) {
        final String name = call.getString("name", "attachment").replaceAll("[\\\\/:*?\"<>|]", "_");
        final String mime = call.getString("mime", "application/octet-stream");
        final String b64 = call.getString("data", "");
        io.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "shared");
                if (dir.exists()) { File[] old = dir.listFiles(); if (old != null) for (File f : old) f.delete(); }
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("cache unavailable");
                File f = new File(dir, name);
                try (FileOutputStream fos = new FileOutputStream(f)) { fos.write(Base64.decode(b64, Base64.DEFAULT)); }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                JSObject r = new JSObject();
                try { getContext().startActivity(i); r.put("opened", true); }
                catch (ActivityNotFoundException e) { r.put("opened", false); r.put("reason", "no-app"); }
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Could not open the attachment: " + e.getMessage(), "OPEN_FAILED");
            }
        });
    }
}
