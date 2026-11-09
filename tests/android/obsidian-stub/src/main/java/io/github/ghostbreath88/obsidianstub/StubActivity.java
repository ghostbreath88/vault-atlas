package io.github.ghostbreath88.obsidianstub;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.widget.TextView;

public class StubActivity extends Activity {
    @Override protected void onCreate(Bundle b) { super.onCreate(b); show(getIntent()); }
    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); show(i); }
    private void show(Intent i) {
        String uri = i.getDataString();
        Log.i("ObsidianStub", "RECEIVED " + uri);
        TextView t = new TextView(this);
        t.setText("Obsidian stub received:\n" + uri);
        t.setContentDescription("stub-received " + uri);
        setContentView(t);
    }
}
