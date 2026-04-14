/**
 * Guest Mode photo storage: cache-only, auto-cleanup on logout/app start.
 * - Storage: app cache/guest_photos (not DCIM, not visible to other apps by default).
 * - .nomedia in folder so system gallery does not index these photos.
 * - Cleanup on Exit Guest Mode and on app start if previous session was guest.
 */
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

const GUEST_PHOTOS_DIR_NAME = 'guest_photos';
const NOMEDIA_FILE = '.nomedia';

/**
 * Returns the absolute path for guest photos (cache directory).
 * Android: getCacheDir()/guest_photos
 * iOS: CachesDirectory/guest_photos
 */
export function getGuestPhotosDir() {
  return `${RNFS.CachesDirectoryPath}/${GUEST_PHOTOS_DIR_NAME}`;
}

/**
 * Ensures guest_photos directory exists and contains .nomedia so system gallery
 * does not show these photos. Call before saving the first guest photo.
 */
export async function ensureGuestPhotosDir() {
  const dir = getGuestPhotosDir();
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
  const nomediaPath = `${dir}/${NOMEDIA_FILE}`;
  if (!(await RNFS.exists(nomediaPath))) {
    await RNFS.writeFile(nomediaPath, '', 'utf8');
  }
  return dir;
}

/**
 * Deletes all guest photos and the guest_photos directory.
 * Safe to call when directory does not exist or is empty.
 * Used on Exit Guest Mode and on app start when previous session was guest.
 */
export async function deleteGuestPhotos() {
  try {
    const dir = getGuestPhotosDir();
    const exists = await RNFS.exists(dir);
    if (!exists) return;

    const items = await RNFS.readDir(dir);
    for (const item of items) {
      try {
        await RNFS.unlink(item.path);
      } catch (e) {
        console.warn('Guest cleanup: could not delete:', item.path, e?.message);
      }
    }
    try {
      await RNFS.unlink(dir);
    } catch (e) {
      console.warn('Guest cleanup: could not remove dir:', dir, e?.message);
    }
  } catch (e) {
    console.warn('deleteGuestPhotos failed:', e?.message || e);
  }
}
