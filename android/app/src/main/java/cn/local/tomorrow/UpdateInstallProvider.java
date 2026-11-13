package cn.local.tomorrow;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;

/**
 * 轻量 FileProvider 等价实现。
 *
 * 项目没有 AndroidX 依赖，因此不使用 androidx.core.content.FileProvider；
 * 这里只暴露 cacheDir/updates/update.apk 一个只读文件，路径固定且不可由调用方拼接。
 */
public class UpdateInstallProvider extends ContentProvider {
    private static final String AUTHORITY_SUFFIX = ".updates";
    private static final String DIR = "updates";
    private static final String FILE = "update.apk";

    private File updateFile() {
        return new File(getContext().getCacheDir(), DIR + File.separator + FILE);
    }

    private boolean isAllowed(Uri uri) {
        if (uri == null) return false;
        if (!(getContext().getPackageName() + AUTHORITY_SUFFIX).equals(uri.getAuthority())) return false;
        List<String> segments = uri.getPathSegments();
        return segments.size() == 2 && DIR.equals(segments.get(0)) && FILE.equals(segments.get(1));
    }

    @Override public boolean onCreate() {
        return true;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) || !isAllowed(uri)) throw new FileNotFoundException("not allowed");
        File file = updateFile();
        if (!file.isFile()) throw new FileNotFoundException("update file missing");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        if (isAllowed(uri)) {
            File file = updateFile();
            if (file.isFile()) cursor.addRow(new Object[]{FILE, file.length()});
        }
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
