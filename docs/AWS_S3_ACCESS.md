# AWS S3 Access for DermaScope

## Overview

The app uses AWS S3 for storing captured images. Images are organized by **username** → **patient folder** → **date** → file. Deletion and fetch behavior are implemented in the **app** (and optionally a backend); S3 itself does not run "policies" for fetch or delete—the app calls the S3 APIs.

---

## IAM Permissions Required

The credentials used by the app (or by your backend if you proxy S3 through an API) must have at least:

| Action | Purpose |
|--------|--------|
| `s3:PutObject` | Upload images after capture |
| `s3:DeleteObject` | Delete objects when user deletes a photo or album in the app |
| `s3:GetObject` | Fetch/download images (e.g. when user logs in on another device) |
| `s3:ListBucket` | List objects by prefix (e.g. by username) for "fetch images on other device" |

### Example IAM policy (bucket name placeholder)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME",
      "Condition": {
        "StringLike": { "s3:prefix": ["*"] }
      }
    }
  ]
}
```

---

## S3 Path Structure

- **Path pattern:** `{username}/{patientId}_{patientName}/{year}/{month}/{day}/{imageId}.jpg`
- Username and patient folder names are sanitized for use as object keys.
- Built in `S3UploadService.buildS3PathFromImage(image)` and used for upload and delete.

---

## Delete: App → S3

- **No "delete policy" is stored in S3.** When the user deletes a photo or an album in the app:
  1. The app calls the S3 **DeleteObject** API for each uploaded image (using the key from the image record).
  2. The app then removes the local file and the record from the local image registry (`ImageDatabase`).
- **Single photo delete:** `GalleryScreen` uses `deleteFileWithCleanup(filePath)`, which looks up the image record, and if `uploadStatus === 'UPLOADED'` calls `deleteObjectFromS3(fullKey)` before deleting the file and DB record.
- **Album delete:** `deleteAlbumWithAllImages` collects all image files in the album and calls `deleteFileWithCleanup` for each, so every uploaded image in that album is deleted from S3, then the local folder is removed.

---

## Fetch (e.g. "other device")

- There is **no "fetch policy" written in AWS**. To show images when the user logs in on another device:
  1. **IAM** must allow `s3:ListBucket` (on the bucket) and `s3:GetObject` (on the objects).
  2. The app (or your backend) must:
     - List objects under the user’s prefix (e.g. `username/`) via **ListObjectsV2**.
     - Use **GetObject** or **presigned URLs** to display or download those images in the gallery.
- The current gallery flow is **local-first**: it reads from the device file system and the local image registry. Adding "fetch from S3 on other device" would require implementing the list/get (or backend) flow and a gallery view for those cloud objects.

---

## Summary

| Concern | Where it lives | Notes |
|--------|----------------|-------|
| Upload | App → S3 PutObject | Path from `buildS3PathFromImage` |
| Delete | App → S3 DeleteObject | Single photo and album delete both use `deleteFileWithCleanup` → `deleteObjectFromS3` |
| Fetch (other device) | IAM + app/backend | ListBucket + GetObject; no policy file in S3 |
