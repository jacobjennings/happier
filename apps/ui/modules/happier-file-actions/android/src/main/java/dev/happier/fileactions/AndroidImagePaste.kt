package dev.happier.fileactions

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import java.io.File
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal object AndroidImagePaste {
  suspend fun copyToCache(context: Context, uri: Uri): Map<String, Any> {
    val resolver = context.contentResolver
    val mimeType = requireNotNull(resolver.getType(uri)) { "Image MIME type is unavailable" }
    require(mimeType.startsWith("image/")) { "Pasted content must be an image" }
    val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType) ?: "img"
    val file = File.createTempFile("pasted-image-", ".$extension", context.cacheDir)
    try {
      val displayName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
      resolver.openInputStream(uri).use { input ->
        requireNotNull(input) { "Pasted image is unavailable" }
        file.outputStream().use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            currentCoroutineContext().ensureActive()
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
          }
        }
      }
      return mapOf(
        "kind" to "native",
        "uri" to Uri.fromFile(file).toString(),
        "name" to (displayName?.takeIf { it.isNotBlank() } ?: file.name),
        "mimeType" to mimeType,
        "sizeBytes" to file.length(),
      )
    } catch (failure: Throwable) {
      if (!file.delete()) android.util.Log.w("HappierImagePaste", "Unable to remove incomplete cached image")
      throw failure
    }
  }
}
