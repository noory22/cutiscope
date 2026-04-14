import { RNS3 } from 'react-native-aws3';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { showInAppToast } from '../utils/Helpers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ImageResizer from 'react-native-image-resizer';
import Config from 'react-native-config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

// S3 Configuration from .env (bucket: cutiscope, region: ap-south-1 Mumbai)
const S3_CONFIG = {
  bucket: (Config.AWS_S3_BUCKET || 'cutiscope').trim(),
  region: (Config.AWS_REGION || 'ap-south-1').trim(),
  accessKey: (Config.AWS_ACCESS_KEY_ID || '').trim(),
  secretKey: (Config.AWS_SECRET_ACCESS_KEY || '').trim(),
  successActionStatus: 201,
};

// ========== HELPER: COMPRESS IMAGE ==========
// Keep output under ~600KB to avoid S3 RequestTimeout on slow networks
const compressImage = async (filePath, originalFileName) => {
  try {
    console.log('🔄 Compressing image to prevent S3 timeout...');

    const response = await ImageResizer.createResizedImage(
      filePath,
      5120, // maxWidth - higher res for better quality (5K)
      5120, // maxHeight
      'JPEG',
      95,   // quality - higher for better clarity
      0,
      null
    );
    console.log(`✅ Compressed! New path: ${response.uri}`);
    console.log(`📉 Size: ${(response.size / 1024).toFixed(0)} KB`);

    return {
      uri: response.uri,
      name: `compressed_${originalFileName}`,
      size: response.size
    };
  } catch (err) {
    console.error('⚠️ Compression failed, using original file:', err);
    return null;
  }
};

const normalizeFsPath = (maybeFileUri) => {
  if (!maybeFileUri) return maybeFileUri;
  return typeof maybeFileUri === 'string' && maybeFileUri.startsWith('file://')
    ? maybeFileUri.replace('file://', '')
    : maybeFileUri;
};

// Sanitize segment for S3 key (alphanumeric, underscore, hyphen)
const sanitizeS3Segment = (str, maxLen = 80) => {
  if (str == null || String(str).trim() === '') return 'unassigned';
  // Match CameraScreen.js sanitizeFolderName logic: replace specific invalid chars with _
  return String(str)
    .replace(/[\s/\\:*?"<>|]/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .slice(0, maxLen);
};

/**
 * Build S3 key from image record (identity from DB, NOT UI).
 * Structure: cutiscope/username/patientId_patientName/year/month/day/imageId.jpg
 * (username = logged-in user name; patient folder = id + name)
 */
export const buildS3PathFromImage = (image) => {
  const date = new Date(image.createdAt || Date.now());
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateSegment = `${d}-${m}-${y}`; // Match CameraScreen.js format

  const userSegment = sanitizeS3Segment(image.userName || image.userId, 50);
  const patientPart = sanitizeS3Segment(image.patientId, 40);
  const namePart = image.patientName ? sanitizeS3Segment(image.patientName, 40) : '';
  const patientFolder = namePart ? `${patientPart}__${namePart}` : patientPart; // Match CameraScreen.js "__" separator

  const keyPrefix = `clinica/${userSegment}/${patientFolder}/${y}/${dateSegment}/`;
  
  // Use original filename from path if available, otherwise fallback to id.jpg
  const originalPath = image.filePath || '';
  const fileName = originalPath.split('/').pop() || `${image.id}.jpg`;
  
  return { keyPrefix, fileName, fullKey: `${keyPrefix}${fileName}` };
};

/**
 * Delete an object from S3 by key. Used when user deletes a photo in the app.
 * IAM user must have s3:DeleteObject on the bucket.
 * @param {string} key - S3 object key (e.g. userId/patientId/year/month/date/imageId.jpg)
 * @returns {Promise<boolean>} true if deleted or key missing, false on error
 */
export const deleteObjectFromS3 = async (key) => {
  if (!key || !S3_CONFIG.bucket || !S3_CONFIG.accessKey || !S3_CONFIG.secretKey) {
    return false;
  }
  try {
    const client = new S3Client({
      region: S3_CONFIG.region,
      credentials: {
        accessKeyId: S3_CONFIG.accessKey,
        secretAccessKey: S3_CONFIG.secretKey,
      },
    });
    await client.send(
      new DeleteObjectCommand({
        Bucket: S3_CONFIG.bucket,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    if (err.name === 'NoSuchKey') return true;
    console.warn('S3 delete failed:', err.message);
    return false;
  }
};

// ========== MAIN UPLOAD FUNCTION ==========
// S3 key structure: clinica/<patient_folder>/images/<fileName>
// patientFolder: optional; when set (e.g. patient id) uploads go to clinica/<patientFolder>/images/
export const uploadToUserS3Folder = async (filePath, fileName, username, metadata = {}, patientFolder = null) => {
  console.log('🚀 ========== S3 UPLOAD START ==========');

  // Track if we used a temporary compressed file so we can delete it later
  let tempCompressedPath = null;

  try {
    // 0. High‑level debug summary (safe, no secrets)
    console.log('🧩 S3 debug summary (no secrets):', {
      bucket: S3_CONFIG.bucket,
      region: S3_CONFIG.region,
      hasAccessKey: !!S3_CONFIG.accessKey,
      hasSecretKey: !!S3_CONFIG.secretKey,
      username,
      fileName,
      patientFolder,
    });

    // 1. Basic validation
    console.log('📊 Input validation...');

    if (!username || username.trim() === '') {
      throw new Error('Username is required');
    }

    if (username.toLowerCase() === 'guest') {
      console.log('👤 Guest user - skipping S3 upload');
      return {
        success: true,
        skipped: true,
        reason: 'Guest user',
        folder: 'guest',
        fileName,
        timestamp: new Date().toISOString()
      };
    }

    // 2. Sanitize username and build folder for S3: clinica/<clinician>/<patient>/images/
    const sanitizedUsername = username
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .substring(0, 50);

    const patientSegmentRaw = (patientFolder != null && String(patientFolder).trim() !== '')
      ? String(patientFolder).trim()
      : 'unassigned';
    const patientSegment = patientSegmentRaw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .substring(0, 80);

    const folderSegment = patientSegment;
    
    // Build date-based subfolders to match local storage: clinica/<user>/<patient>/<year>/<date>/
    const now = new Date(metadata?.timestamp || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const year = String(now.getFullYear());
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const dateSegment = `${day}-${month}-${year}`;

    const keyPrefix = `clinica/${sanitizedUsername}/${folderSegment}/${year}/${dateSegment}/`;

    console.log(`📁 S3 path: ${keyPrefix} (username: "${username}", patientFolder: ${patientFolder || 'none'})`);

    // 3. Check file exists and get size
    console.log(`📂 Checking file: ${filePath}`);
    const fileExists = await RNFS.exists(filePath);

    if (!fileExists) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStat = await RNFS.stat(filePath);
    const fileSizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
    console.log(`📦 Original file size: ${fileStat.size} bytes (${fileSizeMB} MB)`);

    if (fileStat.size === 0) {
      throw new Error('File is empty (0 bytes)');
    }

    // ==========================================
    // 4. COMPRESSION LOGIC
    // ==========================================
    let uploadUri = filePath;
    let uploadName = fileName;

    // Check if we should compress (if file > 2MB and not explicitly disabled)
    // We strictly compress very large files to prevent the "Hanging" issue
    if (fileStat.size > 10 * 1024 * 1024 && !metadata?.directUpload) {
      console.log('⚠️ File is large (>10MB). Compressing to ensure successful upload...');
      const compressed = await compressImage(filePath, fileName);

      if (compressed) {
        uploadUri = compressed.uri;
        uploadName = compressed.name;
        tempCompressedPath = normalizeFsPath(compressed.uri); // Mark for deletion
      }
    }

    // 5. Prepare file URI
    const fileUri = uploadUri.startsWith('file://') ? uploadUri : `file://${uploadUri}`;
    console.log(`🔗 Upload URI: ${fileUri}`);

    // 6. Log S3 configuration
    console.log('⚙️ S3 Configuration:');
    console.log('  Bucket:', S3_CONFIG.bucket);
    console.log('  Region:', S3_CONFIG.region);
    console.log('  Key Prefix:', keyPrefix);

    // 7. Prepare file object for RNS3
    const file = {
      uri: fileUri,
      name: uploadName,
      type: 'image/jpeg',
    };

    console.log('📄 File object prepared');

    // 8. Prepare S3 options (key: clinica/<patient_folder>/images/<fileName>)
    const options = {
      bucket: S3_CONFIG.bucket,
      region: S3_CONFIG.region,
      accessKey: S3_CONFIG.accessKey,
      secretKey: S3_CONFIG.secretKey,
      keyPrefix,
      successActionStatus: 201,
      // We set this to "private" so the library doesn't default to "public-read".
      // If this still fails, you MUST enable ACLs in AWS Console.
      acl: "private",
    };

    // Add metadata
    if (metadata && Object.keys(metadata).length > 0) {
      options.metadata = {
        ...metadata,
        originalFileName: fileName,
        uploadTimestamp: new Date().toISOString(),
        originalSizeMB: fileSizeMB
      };
      console.log('📝 Metadata added');
    }

    console.log('📤 Calling RNS3.put()...');
    console.log('Start time:', new Date().toISOString());

    // 9. Upload to S3
    const response = await RNS3.put(file, options);

    console.log('End time:', new Date().toISOString());
    console.log('📬 S3 Response received');

    // CLEANUP: Delete temporary compressed file to save space
    if (tempCompressedPath) {
      try {
        await RNFS.unlink(normalizeFsPath(tempCompressedPath));
        console.log('🧹 Temporary compressed file cleaned up');
      } catch (e) {
        console.log('⚠️ Failed to clean up temp file:', e.message);
      }
    }

    // Check response
    if (!response) {
      throw new Error('No response from S3');
    }

    console.log('📊 Response status:', response.status);
    console.log('Full Response:', response);

    if (response.status === 201 || response.status === 200) {
      if (!response.body || !response.body.postResponse) {
        console.log('Response body:', response.body);
        throw new Error('Invalid success response from S3');
      }

      const imageUrl = response.body.postResponse.location;
      const s3Key = response.body.postResponse.key || `${keyPrefix}${fileName}`;

      console.log('🎉 ========== S3 UPLOAD SUCCESS ==========');
      console.log(`✅ Uploaded to AWS S3 – bucket: ${S3_CONFIG.bucket}, key: ${s3Key}`);
      console.log(`   🔗 URL: ${imageUrl}`);
      console.log(`   🔑 Key: ${s3Key}`);

      // Save to history
      await saveUploadHistory({
        username: sanitizedUsername,
        folder: folderSegment,
        fileName,
        originalFileName: fileName,
        s3Url: imageUrl,
        s3Key,
        timestamp: new Date().toISOString(),
        statusCode: response.status
      });

      if (Platform.OS === 'android') {
        showInAppToast('Uploaded', { position: 'bottom', durationMs: 1200 });
      }

      return {
        success: true,
        url: imageUrl,
        s3Key,
        folder: folderSegment,
        fileName,
        timestamp: new Date().toISOString(),
        statusCode: response.status
      };

    } else {
      console.error('❌ S3 Upload failed with status:', response.status);
      console.error('Full error response:', response);

      let errorMessage = `S3 upload failed: HTTP ${response.status}`;
      let awsErrorCode = 'Unknown';

      // Parse the actual error from AWS response
      if (response.body) {
        if (typeof response.body === 'string' && response.body.includes('<Error>')) {
          try {
            const codeMatch = response.body.match(/<Code>([^<]+)<\/Code>/);
            const messageMatch = response.body.match(/<Message>([^<]+)<\/Message>/);
            if (codeMatch && messageMatch) {
              awsErrorCode = codeMatch[1];
              errorMessage = `S3 Error [${awsErrorCode}]: ${messageMatch[1]}`;
            }
          } catch (parseError) { }
        } else if (typeof response.body === 'object' && response.body.error) {
          errorMessage = `S3 Error: ${response.body.error}`;
        }
      }

      console.error('Error message:', errorMessage);

      await saveUploadError({
        username: sanitizedUsername,
        fileName,
        error: errorMessage,
        awsErrorCode,
        statusCode: response.status,
        timestamp: new Date().toISOString(),
      });

      throw new Error(errorMessage);
    }

  } catch (error) {
    console.error('💥 ========== S3 UPLOAD ERROR ==========');
    console.error('Error:', error);

    // Clean up temp file on error too
    if (tempCompressedPath) {
      try { await RNFS.unlink(normalizeFsPath(tempCompressedPath)); } catch (e) { }
    }

    await saveUploadError({
      username: username || 'unknown',
      fileName: fileName || 'unknown',
      error: error.toString(),
      timestamp: new Date().toISOString(),
    });

    // Rethrow so caller (e.g. CameraScreen) can show failure and not report success
    throw error;
  }
};

/**
 * Upload using image record (path from DB identity, NOT current UI).
 * Use this so uploads always go to the correct user/patient.
 */
export const uploadWithImageRecord = async (filePath, image) => {
  let tempCompressedPath = null;
  const resolvedPath = normalizeFsPath(filePath);
  const { keyPrefix, fileName } = buildS3PathFromImage(image);

  if (!image || !image.id) throw new Error('Image record with id is required');
  const fileExists = await RNFS.exists(resolvedPath);
  if (!fileExists) throw new Error(`File not found: ${resolvedPath}`);

  const fileStat = await RNFS.stat(resolvedPath);
  if (fileStat.size === 0) throw new Error('File is empty (0 bytes)');
  const fileSizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);

  let uploadUri = resolvedPath;
  // Use original filename from local path (e.g. Cutiscope_1_20260402_170229.jpg)
  let uploadName = resolvedPath.split('/').pop() || fileName;

  if (fileStat.size > 10 * 1024 * 1024) {
    const compressed = await compressImage(resolvedPath, uploadName);
    if (compressed) {
      uploadUri = normalizeFsPath(compressed.uri);
      // Keep the original filename even after compression
      tempCompressedPath = uploadUri;
    }
  }

  const fileUri = uploadUri.startsWith('file://') ? uploadUri : `file://${uploadUri}`;
  const file = { uri: fileUri, name: uploadName, type: 'image/jpeg' };
  const options = {
    bucket: S3_CONFIG.bucket,
    region: S3_CONFIG.region,
    accessKey: S3_CONFIG.accessKey,
    secretKey: S3_CONFIG.secretKey,
    keyPrefix,
    successActionStatus: 201,
    acl: 'private',
    metadata: {
      userId: image.userId,
      patientId: image.patientId,
      uploadTimestamp: new Date().toISOString(),
      originalSizeMB: fileSizeMB,
    },
  };

  try {
    console.log(`📁 S3 path from image record: ${keyPrefix}${uploadName}`);
    const response = await RNS3.put(file, options);
    if (tempCompressedPath) {
      try { await RNFS.unlink(tempCompressedPath); } catch (e) { }
    }
    if (!response || (response.status !== 201 && response.status !== 200)) {
      throw new Error(response ? `S3 upload failed: HTTP ${response.status}` : 'No response from S3');
    }
    const imageUrl = response.body?.postResponse?.location;
    const s3Key = response.body?.postResponse?.key || `${keyPrefix}${uploadName}`;
    if (Platform.OS === 'android') showInAppToast('Uploaded', { position: 'bottom', durationMs: 1200 });
    return {
      success: true,
      url: imageUrl,
      s3Key,
      fileName: uploadName,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    if (tempCompressedPath) {
      try { await RNFS.unlink(tempCompressedPath); } catch (e) { }
    }
    throw err;
  }
};

// ========== BACKGROUND UPLOAD FUNCTION (FIRE & FORGET) ==========
export const uploadInBackground = async (filePath, fileName, username) => {
  // Fire and forget - do not await this function unless you want to block
  (async () => {
    try {
      // Validate connectivity first to avoid silent failures
      // (Optional: import NetInfo if needed, or rely on RNS3 failure)

      console.log(`🚀 Starting background upload for ${fileName}...`);

      // Call the main upload logic
      const result = await uploadToUserS3Folder(filePath, fileName, username);

      if (result.success) {
        console.log('✅ Background upload success:', result.s3Key);
        // Optional: Fire a toast? Or keep it silent as user requested "don't stop UI"
        // If we toast too much it might look like UI lag.
      } else {
        console.warn('⚠️ Background upload reported failure:', result.error);
      }
    } catch (error) {
      console.error('❌ Background upload critical error:', error);
    }
  })();
};

// ========== SIMPLE UPLOAD FUNCTION ==========
export const uploadImageToS3 = async (filePath, fileName, username, metadata = {}) => {
  return await uploadToUserS3Folder(filePath, fileName, username, {
    ...metadata,
  });
};

// ========== TEST FUNCTION TO CHECK BUCKET SETTINGS ==========
export const testBucketACLSetting = async () => {
  console.log('🔧 Testing bucket ACL settings...');
  try {
    const testFilePath = `${RNFS.CachesDirectoryPath}/test_acl_${Date.now()}.txt`;
    await RNFS.writeFile(testFilePath, 'Testing bucket ACL settings', 'utf8');

    const file = {
      uri: `file://${testFilePath}`,
      name: `test_acl_${Date.now()}.txt`,
      type: 'text/plain',
    };

    const options = {
      bucket: S3_CONFIG.bucket,
      region: S3_CONFIG.region,
      accessKey: S3_CONFIG.accessKey,
      secretKey: S3_CONFIG.secretKey,
      keyPrefix: 'test-acl/',
      successActionStatus: 201,
      acl: "private", // Explicitly private
    };

    console.log('Testing upload without ACL...');
    const response = await RNS3.put(file, options);
    console.log('ACL test response:', response);

    if (response.status === 201 || response.status === 200) {
      return { success: true, message: '✅ Bucket accepts uploads', status: response.status };
    } else {
      return { success: false, error: `HTTP ${response.status}`, response: response.body };
    }
  } catch (error) {
    console.error('ACL test error:', error);
    return { success: false, error: error.message };
  }
};

// ========== TEST FUNCTION WITH SMALL FILE ==========
export const testS3UploadWithSmallFile = async (username = 'testuser') => {
  console.log('🧪 ========== S3 UPLOAD TEST START ==========');
  try {
    const testFilePath = `${RNFS.CachesDirectoryPath}/test_${Date.now()}.txt`;
    const testContent = 'This is a test file for S3 upload verification';
    await RNFS.writeFile(testFilePath, testContent, 'utf8');

    const testResult = await uploadToUserS3Folder(
      testFilePath,
      `test_${Date.now()}.txt`,
      username,
      { test: true }
    );

    try { await RNFS.unlink(testFilePath); } catch (e) { }
    return testResult;
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ========== CHECK S3 CREDENTIALS ==========
export const checkS3Credentials = () => {
  console.log('🔐 Checking S3 credentials...');
  const issues = [];
  if (!S3_CONFIG.accessKey || S3_CONFIG.accessKey.length < 20) issues.push('Access key appears invalid');
  if (!S3_CONFIG.secretKey || S3_CONFIG.secretKey.length < 20) issues.push('Secret key appears invalid');
  if (!S3_CONFIG.bucket) issues.push('Bucket name is empty');
  if (!S3_CONFIG.region) issues.push('Region is empty');

  return issues.length > 0 ? { valid: false, issues } : { valid: true };
};

// ========== HELPER FUNCTIONS ==========
const saveUploadHistory = async (uploadData) => {
  try {
    const historyKey = 's3_upload_history';
    const existing = await AsyncStorage.getItem(historyKey);
    const history = existing ? JSON.parse(existing) : [];
    history.unshift({ ...uploadData, id: Date.now().toString() });
    await AsyncStorage.setItem(historyKey, JSON.stringify(history.slice(0, 50)));
  } catch (error) { console.error('History save error:', error); }
};

const saveUploadError = async (errorData) => {
  try {
    const errorKey = 's3_upload_errors';
    const existing = await AsyncStorage.getItem(errorKey);
    const errors = existing ? JSON.parse(existing) : [];
    errors.unshift({ ...errorData, id: Date.now().toString() });
    await AsyncStorage.setItem(errorKey, JSON.stringify(errors.slice(0, 50)));
  } catch (error) { console.error('Error save error:', error); }
};

export const getS3UploadHistory = async () => {
  try { return JSON.parse(await AsyncStorage.getItem('s3_upload_history')) || []; } catch (e) { return []; }
};

export const getS3UploadErrors = async () => {
  try { return JSON.parse(await AsyncStorage.getItem('s3_upload_errors')) || []; } catch (e) { return []; }
};

export const clearS3History = async () => {
  try {
    await AsyncStorage.removeItem('s3_upload_history');
    await AsyncStorage.removeItem('s3_upload_errors');
    console.log('🧹 S3 history cleared');
  } catch (error) { console.error('Error clearing S3 history:', error); }
};

export const debugS3Issues = async () => {
  console.log('🔍 ========== S3 DEBUG START ==========');
  const credentialCheck = checkS3Credentials();
  const aclTest = await testBucketACLSetting();
  const uploadTest = await testS3UploadWithSmallFile();
  const recentErrors = await getS3UploadErrors();

  return { credentialCheck, aclTest, uploadTest, recentErrors: recentErrors.slice(0, 5) };
};

export default {
  uploadToUserS3Folder,
  uploadImageToS3,
  testBucketACLSetting,
  testS3UploadWithSmallFile,
  checkS3Credentials,
  debugS3Issues,
  getS3UploadHistory,
  getS3UploadErrors,
  clearS3History,
  uploadInBackground,
};