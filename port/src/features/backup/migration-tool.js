import { normalizePortfolio, LEGACY_STORAGE_KEY } from '../../utils/normalize.js';
import { saveBlob } from '../../utils/blob-download.js';
import { dialog } from '../../ui/dialog.js';
import { showToast } from '../../ui/toast.js';
import { icon } from '../../ui/icons.js';
import { MediaService } from '../../services/media-service.js';

/**
 * One-Time Owner-Only Data Migration Tool (Phase 11)
 *
 * Requirements:
 * 1. Export backup before migration.
 * 2. Read existing browser data from `deepak-dh-2633115-v1`.
 * 3. Validate using normalize logic.
 * 4. Preserve readings, project, archive, and process data.
 * 5. Preview migration.
 * 6. Require explicit owner confirmation.
 * 7. Never automatically overwrite existing cloud content.
 * 8. Never delete old localStorage data automatically.
 * 9. Report base64 archive images that need external URL replacement.
 * 10. Preserve original data until migration has been verified.
 */
export class MigrationTool {
  /**
   * @param {() => object} getCloudPortfolio
   * @param {(data: object) => Promise<void>} onSaveToCloud
   * @param {() => boolean} isOwnerCheck
   * @param {() => void} requestOwnerLogin
   */
  constructor(getCloudPortfolio, onSaveToCloud, isOwnerCheck, requestOwnerLogin) {
    this.getCloudPortfolio = getCloudPortfolio;
    this.onSaveToCloud = onSaveToCloud;
    this.isOwnerCheck = isOwnerCheck;
    this.requestOwnerLogin = requestOwnerLogin;
  }

  readLocalData() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return null;
      return normalizePortfolio(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  showMigrationDialog() {
    if (!this.isOwnerCheck()) {
      this.requestOwnerLogin();
      return;
    }

    const localData = this.readLocalData();
    if (!localData) {
      dialog.open(
        'DATA MIGRATION TOOL',
        'No Local Data Found',
        `<p>No legacy data was found under localStorage key <code>${LEGACY_STORAGE_KEY}</code> in this browser.</p>
         <p class="small-notice">Your browser storage is clean, or this browser hasn't been used with the older version of the portfolio.</p>`
      );
      return;
    }

    // Inspect statistics
    const readingsCount = Object.keys(localData.readings || {}).length;
    const projectFieldsCount = Object.values(localData.project || {}).filter(Boolean).length;
    const archiveRecords = localData.archive || [];
    const archiveCount = archiveRecords.length;

    // Detect base64 images that should be replaced with external URLs
    const base64Records = archiveRecords.filter(r => MediaService.isBase64(r.image));

    dialog.open(
      'DATA MIGRATION TOOL',
      'Migrate Browser Data to Cloud Database',
      `<p class="form-help">Found existing portfolio data in this browser (Key: <code>${LEGACY_STORAGE_KEY}</code>). Review the preview below before migrating to your cloud backend.</p>

       <div class="missing-work" style="margin-bottom:20px">
         <h3>Migration Preview</h3>
         <ul style="font-size:12px;margin:8px 0;padding-left:18px;line-height:1.8">
           <li><strong>Readings with notes:</strong> ${readingsCount} entries</li>
           <li><strong>Project fields completed:</strong> ${projectFieldsCount} fields</li>
           <li><strong>Archive records:</strong> ${archiveCount} records</li>
           <li><strong>Last updated locally:</strong> ${localData.updatedAt ? new Date(localData.updatedAt).toLocaleString() : 'Not recorded'}</li>
         </ul>
       </div>

       ${base64Records.length > 0 ? `
         <div style="border:1px solid var(--coral);border-radius:8px;padding:14px;margin-bottom:20px;background:var(--bg2)">
           <strong style="color:var(--coral);font-size:12px">Base64 Images Advisory (${base64Records.length} records):</strong>
           <p class="small-notice" style="margin:5px 0 0">
             The following records contain embedded base64 images: <em>${base64Records.map(r => r.title || r.id).join(', ')}</em>.<br>
             While these images are preserved during migration, external media URLs are recommended for clean cloud hosting.
           </p>
         </div>
       ` : ''}

       <p class="small-notice">
         <strong>Safety rules:</strong><br>
         1. A backup JSON will be automatically downloaded to your computer first.<br>
         2. Your browser's local copy will NOT be deleted.<br>
         3. Cloud database will only update after your explicit confirmation.
       </p>

       <div class="form-actions" style="margin-top:24px">
         <button type="button" class="btn small" onclick="document.getElementById('detail-dialog').close()">Cancel</button>
         <button class="btn primary small" id="execute-migration-btn">
           Backup & Migrate to Cloud ${icon('arrow', 'sm')}
         </button>
       </div>`
    );

    document.getElementById('execute-migration-btn')?.addEventListener('click', async () => {
      await this.executeMigration(localData);
    });
  }

  async executeMigration(localData) {
    if (!this.isOwnerCheck()) {
      this.requestOwnerLogin();
      return;
    }

    // 1. Export complete JSON backup before migration
    const backupBlob = new Blob([JSON.stringify(localData, null, 2)], { type: 'application/json' });
    saveBlob(backupBlob, `pre_migration_backup_${Date.now()}.json`);
    showToast('Saved pre-migration backup JSON.');

    // 2. Check whether cloud document already exists in Firestore
    let existingCloud = null;
    try {
      existingCloud = await this.getCloudPortfolio();
    } catch (err) {
      console.warn('Could not inspect existing cloud data prior to migration:', err);
    }

    const cloudHasData = existingCloud && (
      (existingCloud.updatedAt && existingCloud.updatedAt > 0) ||
      (existingCloud.archive && existingCloud.archive.length > 0) ||
      (existingCloud.project && Object.values(existingCloud.project).some(Boolean)) ||
      (existingCloud.readings && Object.keys(existingCloud.readings).length > 0)
    );

    // 3. Prevent automatic overwrite; require explicit replacement confirmation on conflict
    if (cloudHasData) {
      const cloudUpdatedDate = existingCloud.updatedAt
        ? new Date(existingCloud.updatedAt).toLocaleString()
        : 'recorded timestamp';

      const confirmOverwrite = confirm(
        `CONFLICT WARNING: Cloud Firestore already contains portfolio data (last updated: ${cloudUpdatedDate})!\n\n` +
        'Proceeding will replace the existing cloud document with your verified local records.\n\n' +
        'Do you explicitly confirm replacing the cloud portfolio with your local records?'
      );

      if (!confirmOverwrite) {
        showToast('Migration cancelled. Existing cloud data was preserved.');
        return;
      }
    } else {
      const confirmed = confirm(
        'Are you sure you want to upload this browser data to Cloud Firestore?\n' +
        'A pre-migration JSON backup has been saved to your computer.'
      );
      if (!confirmed) {
        showToast('Migration cancelled.');
        return;
      }
    }

    try {
      // 4. Save to cloud database
      await this.onSaveToCloud(localData);

      // 5. Verify migrated data by reading it back from cloud
      const verifiedData = await this.getCloudPortfolio();
      if (!verifiedData) {
        throw new Error('Verification read-back failed: No data returned from cloud backend.');
      }

      showToast('Migration complete and verified! Cloud database is now up to date.');
      dialog.open(
        'MIGRATION COMPLETE',
        'Verification & Success',
        `<p>Your local portfolio data has been successfully synchronized to Cloud Firestore.</p>
         <p><strong>Verification result:</strong> Read-back verified (${(verifiedData.archive || []).length} archive records, ${Object.keys(verifiedData.readings || {}).length} readings).</p>
         <p>All visitors will now see these records when visiting the portfolio.</p>
         <p class="small-notice">Your local browser copy under <code>${LEGACY_STORAGE_KEY}</code> was safely preserved intact.</p>`
      );
    } catch (err) {
      showToast(`Migration failed: ${err.message}`);
    }
  }
}
