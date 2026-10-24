package dev.happier.fileactions

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.view.View
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.util.Log
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.sync.Mutex
import java.io.Serializable

internal data class SaveDocumentOptions(val name: String, val mimeType: String) : Serializable

internal class SaveDocumentContract : AppContextActivityResultContract<SaveDocumentOptions, String?> {
  override fun createIntent(context: Context, input: SaveDocumentOptions): Intent =
    AndroidFileActions.documentIntent(input.name, input.mimeType)

  override fun parseResult(input: SaveDocumentOptions, resultCode: Int, intent: Intent?): String? {
    if (resultCode != Activity.RESULT_OK) return null
    return requireNotNull(intent?.data) { "Save destination is unavailable" }.toString()
  }
}

class HappierFileActionsModule : Module() {
  private lateinit var saveLauncher: AppContextActivityResultLauncher<SaveDocumentOptions, String?>
  private val saveMutex = Mutex()
  private val imagePasteScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val imagePasteTargets = mutableMapOf<Int, View>()

  override fun definition() = ModuleDefinition {
    Name("HappierFileActions")

    Events("imagePaste")

    OnDestroy {
      imagePasteScope.cancel()
      imagePasteTargets.values.forEach { view ->
        view.post { ViewCompat.setOnReceiveContentListener(view, null, null) }
      }
      imagePasteTargets.clear()
    }

    AsyncFunction("setImagePasteTarget") { target: Int, enabled: Boolean ->
      val previous = imagePasteTargets.remove(target)
      if (!enabled) {
        previous?.let { ViewCompat.setOnReceiveContentListener(it, null, null) }
      } else {
        val view = requireNotNull(appContext.throwingActivity.findViewById<View>(target)) {
          "Image paste input is unavailable"
        }
        imagePasteTargets[target] = view
        ViewCompat.setOnReceiveContentListener(view, arrayOf("image/*")) { _, payload ->
          val resolver = view.context.contentResolver
          val split = payload.partition { item ->
            item.uri?.let { uri -> resolver.getType(uri)?.startsWith("image/") } == true
          }
          split.first?.let { images ->
            // Keep the payload alive until copying finishes: it owns temporary IME URI grants.
            imagePasteScope.launch {
              for (index in 0 until images.clip.itemCount) {
                try {
                  val attachment = AndroidImagePaste.copyToCache(view.context, images.clip.getItemAt(index).uri)
                  withContext(Dispatchers.Main) {
                    if (imagePasteTargets[target] === view) {
                      sendEvent("imagePaste", mapOf("target" to target, "attachment" to attachment))
                    }
                  }
                } catch (failure: CancellationException) {
                  throw failure
                } catch (failure: Exception) {
                  Log.e("HappierImagePaste", "Unable to attach pasted image", failure)
                  withContext(Dispatchers.Main) {
                    if (imagePasteTargets[target] === view) {
                      sendEvent("imagePaste", mapOf("target" to target, "error" to "image_read_failed"))
                    }
                  }
                }
              }
            }
          }
          // Leave text and unsupported content to AppCompatEditText.
          split.second
        }
        // A focused autoFocus input may already have an IME connection without the MIME types.
        if (view.hasFocus()) {
          (view.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).restartInput(view)
        }
      }
    }.runOnQueue(Queues.MAIN)

    RegisterActivityContracts {
      saveLauncher = registerForActivityResult(SaveDocumentContract()) { _, _ -> }
    }

    AsyncFunction("saveFile") Coroutine { fileUri: String, name: String ->
      check(saveMutex.tryLock()) { "Another save is already in progress" }
      try {
        val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
        val file = AndroidFileActions.checkedDownloadFile(context, fileUri)
        val selectedUri = saveLauncher.launch(SaveDocumentOptions(name, AndroidFileActions.mimeType(name)))
        if (selectedUri == null) {
          mapOf("canceled" to true)
        } else {
          AndroidFileActions.copyToDocument(context, file, selectedUri)
          mapOf("canceled" to false, "uri" to selectedUri)
        }
      } finally {
        saveMutex.unlock()
      }
    }

    AsyncFunction("openFile") { fileUri: String, name: String ->
      launchFileIntent(fileUri, name, share = false)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("shareFile") { fileUri: String, name: String, dialogTitle: String? ->
      launchFileIntent(fileUri, name, share = true, dialogTitle = dialogTitle)
    }.runOnQueue(Queues.MAIN)
  }

  private fun launchFileIntent(fileUri: String, name: String, share: Boolean, dialogTitle: String? = null) {
    val context = requireNotNull(appContext.reactContext) { "App context is unavailable" }
    val file = AndroidFileActions.checkedDownloadFile(context, fileUri)
    val uri = AndroidFileActions.contentUri(context, file, name)
    val intent = AndroidFileActions.fileIntent(uri, name, share)
    val chooser = AndroidFileActions.chooserIntent(intent, dialogTitle)
    appContext.throwingActivity.startActivity(chooser)
  }
}
