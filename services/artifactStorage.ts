/**
 * Persistent Client-Side and Server-Side Artifact & Image Store.
 * Ensures UI Testing reports, screenshots, highlighted audit overlays,
 * and input assets are reliably persisted and viewable permanently across reloads,
 * tab sessions, folder navigations, and Firestore sync events.
 */

const DB_NAME = 'AutomatiQA_Artifacts_DB';
const DB_VERSION = 1;
const STORE_NAME = 'ui_testing_artifacts';

interface ArtifactEntry {
  id: string;
  data: any;
  updatedAt: number;
}

// In-memory fallback cache
const memoryCache = new Map<string, any>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event: any) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event: any) => {
          resolve(event.target.result);
        };

        request.onerror = (err) => {
          console.warn('[ArtifactStorage] IndexedDB open error, using memory cache:', err);
          resolve(null);
        };
      } catch (err) {
        console.warn('[ArtifactStorage] IndexedDB init exception, using memory cache:', err);
        resolve(null);
      }
    });
  }

  return dbPromise;
}

/**
 * Save an artifact bundle or image by key/ID (IndexedDB + Server API fallback)
 */
export async function saveArtifact(id: string, data: any): Promise<void> {
  if (!id || !data) return;

  memoryCache.set(id, data);

  // 1. IndexedDB persistence
  try {
    const db = await getDB();
    if (db) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: ArtifactEntry = {
        id,
        data,
        updatedAt: Date.now()
      };
      store.put(entry);
    }
  } catch (err) {
    console.warn('[ArtifactStorage] Error saving to IndexedDB:', err);
  }

  // 2. Server Disk Persistence (async background)
  if (typeof fetch !== 'undefined') {
    try {
      fetch('/api/artifacts/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, data })
      }).catch(() => {});
    } catch {}
  }
}

/**
 * Retrieve an artifact bundle or image by key/ID (Memory -> IndexedDB -> Server)
 */
export async function getArtifact(id: string): Promise<any | null> {
  if (!id) return null;

  if (memoryCache.has(id)) {
    return memoryCache.get(id);
  }

  // 1. Check IndexedDB
  try {
    const db = await getDB();
    if (db) {
      const result = await new Promise<any>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);

        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result.data);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => {
          resolve(null);
        };
      });

      if (result) {
        memoryCache.set(id, result);
        return result;
      }
    }
  } catch (err) {
    console.warn('[ArtifactStorage] Error reading from IndexedDB:', err);
  }

  // 2. Check Server API
  if (typeof fetch !== 'undefined') {
    try {
      const res = await fetch(`/api/artifacts/${id}`);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const json = await res.json();
          memoryCache.set(id, json);
          return json;
        } else if (contentType.includes('image/')) {
          const blob = await res.blob();
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((resolve) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
          if (dataUrl) {
            memoryCache.set(id, dataUrl);
            return dataUrl;
          }
        }
      }
    } catch {}
  }

  return null;
}

/**
 * Helper to save video binary or blob in IndexedDB
 */
export async function saveVideoBlob(videoId: string, blobOrFile: Blob | File | ArrayBuffer | string): Promise<void> {
  if (!videoId || !blobOrFile) return;
  await saveArtifact(`video_${videoId}`, blobOrFile);
}

/**
 * Retrieve stored video Blob or data from IndexedDB
 */
export async function getVideoBlob(videoId: string): Promise<Blob | File | string | null> {
  if (!videoId) return null;
  return await getArtifact(`video_${videoId}`);
}

/**
 * Resolves a reliable, playable URL for a video across reloads and tab sessions
 */
export async function resolveVideoPlayableUrl(video: { id?: string; url?: string; blob?: any; dataUrl?: string } | null | undefined): Promise<string | null> {
  if (!video) return null;

  // 1. Direct active Blob / File in memory
  if (video.blob instanceof Blob) {
    try {
      return URL.createObjectURL(video.blob);
    } catch {}
  }

  // 2. Base64 or remote URL
  if (video.url && (video.url.startsWith('data:') || video.url.startsWith('http://') || video.url.startsWith('https://') || video.url.startsWith('/artifacts/'))) {
    return video.url;
  }
  if (video.dataUrl && (video.dataUrl.startsWith('data:') || video.dataUrl.startsWith('http://') || video.dataUrl.startsWith('https://') || video.dataUrl.startsWith('/artifacts/'))) {
    return video.dataUrl;
  }

  // 3. Stored in IndexedDB under video ID
  if (video.id) {
    const stored: any = await getVideoBlob(video.id);
    if (stored) {
      if (typeof Blob !== 'undefined' && stored instanceof Blob) {
        try {
          return URL.createObjectURL(stored);
        } catch {}
      } else if (typeof stored === 'string' && (stored.startsWith('data:') || stored.startsWith('http') || stored.startsWith('/artifacts/'))) {
        return stored;
      } else if (typeof ArrayBuffer !== 'undefined' && stored instanceof ArrayBuffer) {
        try {
          const blob = new Blob([stored], { type: 'video/mp4' });
          return URL.createObjectURL(blob);
        } catch {}
      }
    }
  }

  // 4. If video.url is a blob: URL, check if still alive
  if (video.url && video.url.startsWith('blob:')) {
    return video.url;
  }

  return null;
}

/**
 * Helper to upload/persist a single image to the server disk and IndexedDB.
 * Returns the permanent server URL (e.g. `/artifacts/img_...png`) or original data URL.
 */
export async function persistImageArtifact(key: string, dataUrl: string): Promise<string> {
  if (!key || !dataUrl) return '';

  // If already a persistent static URL, return it
  if (dataUrl.startsWith('/artifacts/') || dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
    return dataUrl;
  }

  // Cache in IndexedDB & memory
  await saveArtifact(key, dataUrl);

  // Send to server
  try {
    const res = await fetch('/api/artifacts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: key, image: dataUrl })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.url) {
        return data.url;
      }
    }
  } catch (err) {
    console.warn('[ArtifactStorage] Server image save fallback to local:', err);
  }

  return dataUrl;
}

export interface ReportArtifactsBundle {
  highlightedScreenshots?: string[];
  visualDefectsScreenshots?: string[];
  appScreenshots?: string[];
  figmaImages?: string[];
  screenshots?: string[];
  images?: string[];
  correctedImage?: string | null;
  docs?: any[];
  figmaDocs?: any[];
  appDocs?: any[];
  videos?: any[];
  appVideos?: any[];
  report?: string;
  analysisReport?: string;
  comparisonReport?: string;
  correctedReport?: string;
  resolutionGuide?: string;
  appUrl?: string;
  figmaUrl?: string;
  designLink?: string;
  promptInputs?: string;
  url?: string;
  contrastOutputs?: any[];
  correctedScreenshots?: any[];
  companyStandards?: string;
  standardRequirement?: any;
}

/**
 * Persists all report images and bundles to both Server Disk and IndexedDB,
 * returning lightweight permanent URLs suitable for Firestore (staying well under 1MB).
 */
export async function saveReportArtifacts(
  reportId: string, 
  artifacts: ReportArtifactsBundle
): Promise<{ permanentBundle: ReportArtifactsBundle }> {
  if (!reportId) return { permanentBundle: artifacts };

  const sanitizedId = reportId.replace(/[^a-zA-Z0-9_\-]/g, '_');

  // 1. Save full in-memory bundle to IndexedDB & Server disk immediately
  await saveArtifact(`report_${sanitizedId}`, artifacts);

  // Save video binaries if present
  const videoList = [...(artifacts.videos || []), ...(artifacts.appVideos || [])];
  for (const vid of videoList) {
    if (vid && vid.id) {
      if (vid.blob instanceof Blob || vid.file instanceof Blob) {
        await saveVideoBlob(vid.id, vid.blob || vid.file);
      } else if (vid.dataUrl && typeof vid.dataUrl === 'string' && vid.dataUrl.startsWith('data:')) {
        await saveVideoBlob(vid.id, vid.dataUrl);
      }
    }
  }

  // 2. Persist individual images to server disk & IndexedDB in parallel
  const convertImageList = async (list: string[] | undefined, prefix: string): Promise<string[]> => {
    if (!list || !Array.isArray(list)) return [];
    return Promise.all(
      list.map(async (img, idx) => {
        if (!img || typeof img !== 'string') return '';
        const key = `img_${sanitizedId}_${prefix}_${idx}`;
        return await persistImageArtifact(key, img);
      })
    );
  };

  const [
    permScreenshots,
    permImages,
    permAppScreenshots,
    permFigmaImages,
    permHighlighted,
    permDefects,
    permCorrected
  ] = await Promise.all([
    convertImageList(artifacts.screenshots, 'screenshot'),
    convertImageList(artifacts.images, 'image'),
    convertImageList(artifacts.appScreenshots, 'app'),
    convertImageList(artifacts.figmaImages, 'figma'),
    convertImageList(artifacts.highlightedScreenshots, 'highlight'),
    convertImageList(artifacts.visualDefectsScreenshots, 'defects'),
    artifacts.correctedImage && typeof artifacts.correctedImage === 'string'
      ? persistImageArtifact(`img_${sanitizedId}_corrected`, artifacts.correctedImage)
      : Promise.resolve(null)
  ]);

  const permanentBundle: ReportArtifactsBundle = {
    ...artifacts,
    screenshots: permScreenshots.filter(Boolean),
    images: permImages.filter(Boolean),
    appScreenshots: permAppScreenshots.filter(Boolean),
    figmaImages: permFigmaImages.filter(Boolean),
    highlightedScreenshots: permHighlighted.filter(Boolean),
    visualDefectsScreenshots: permDefects.filter(Boolean),
    correctedImage: permCorrected || undefined
  };

  // Also save the permanent bundle record
  await saveArtifact(`perm_report_${sanitizedId}`, permanentBundle);

  return { permanentBundle };
}

/**
 * Hydrates a repository item with any cached artifacts from IndexedDB/Server if the cloud payload
 * had pruned or missing image strings.
 */
export async function hydrateReportArtifacts(item: any): Promise<any> {
  if (!item || !item.id) return item;

  const sanitizedId = String(item.id).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const cached = (await getArtifact(`report_${sanitizedId}`)) || (await getArtifact(`perm_report_${sanitizedId}`));
  const merged = { ...item };

  // Helper to filter out blank/empty strings from arrays
  const cleanList = (arr: any): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.filter(s => typeof s === 'string' && s.trim().length > 0);
  };

  merged.screenshots = cleanList(merged.screenshots);
  merged.images = cleanList(merged.images);
  merged.appScreenshots = cleanList(merged.appScreenshots);
  merged.figmaImages = cleanList(merged.figmaImages);
  merged.highlightedScreenshots = cleanList(merged.highlightedScreenshots);
  merged.visualDefectsScreenshots = cleanList(merged.visualDefectsScreenshots);

  if (cached) {
    if (merged.screenshots.length === 0 && cleanList(cached.screenshots).length > 0) {
      merged.screenshots = cleanList(cached.screenshots);
    }

    if (merged.images.length === 0 && cleanList(cached.images).length > 0) {
      merged.images = cleanList(cached.images);
    }

    if (merged.appScreenshots.length === 0 && cleanList(cached.appScreenshots).length > 0) {
      merged.appScreenshots = cleanList(cached.appScreenshots);
    }

    if (merged.figmaImages.length === 0 && cleanList(cached.figmaImages).length > 0) {
      merged.figmaImages = cleanList(cached.figmaImages);
    }

    if (merged.highlightedScreenshots.length === 0 && cleanList(cached.highlightedScreenshots).length > 0) {
      merged.highlightedScreenshots = cleanList(cached.highlightedScreenshots);
    }

    if (merged.visualDefectsScreenshots.length === 0 && cleanList(cached.visualDefectsScreenshots).length > 0) {
      merged.visualDefectsScreenshots = cleanList(cached.visualDefectsScreenshots);
    }

    if (!merged.correctedImage && cached.correctedImage) {
      merged.correctedImage = cached.correctedImage;
    }

    if ((!merged.videos || merged.videos.length === 0) && cached.videos?.length > 0) {
      merged.videos = cached.videos;
    }

    if ((!merged.appVideos || merged.appVideos.length === 0) && cached.appVideos?.length > 0) {
      merged.appVideos = cached.appVideos;
    }

    if ((!merged.docs || merged.docs.length === 0) && cached.docs?.length > 0) {
      merged.docs = cached.docs;
    }

    if ((!merged.figmaDocs || merged.figmaDocs.length === 0) && cached.figmaDocs?.length > 0) {
      merged.figmaDocs = cached.figmaDocs;
    }

    if ((!merged.appDocs || merged.appDocs.length === 0) && cached.appDocs?.length > 0) {
      merged.appDocs = cached.appDocs;
    }

    if (!merged.appUrl && cached.appUrl) {
      merged.appUrl = cached.appUrl;
    }

    if (!merged.figmaUrl && cached.figmaUrl) {
      merged.figmaUrl = cached.figmaUrl;
    }

    if (!merged.url && cached.url) {
      merged.url = cached.url;
    }

    if (!merged.designLink && cached.designLink) {
      merged.designLink = cached.designLink;
    }

    if (!merged.promptInputs && cached.promptInputs) {
      merged.promptInputs = cached.promptInputs;
    }

    if (!merged.report && cached.report) {
      merged.report = cached.report;
    }

    if (!merged.analysisReport && cached.analysisReport) {
      merged.analysisReport = cached.analysisReport;
    }

    if (!merged.comparisonReport && cached.comparisonReport) {
      merged.comparisonReport = cached.comparisonReport;
    }

    if (!merged.correctedReport && cached.correctedReport) {
      merged.correctedReport = cached.correctedReport;
    }

    if (!merged.resolutionGuide && cached.resolutionGuide) {
      merged.resolutionGuide = cached.resolutionGuide;
    }

    if (!merged.companyStandards && cached.companyStandards) {
      merged.companyStandards = cached.companyStandards;
    }

    if (!merged.standardRequirement && cached.standardRequirement) {
      merged.standardRequirement = cached.standardRequirement;
    }

    if ((!merged.contrastOutputs || merged.contrastOutputs.length === 0) && cached.contrastOutputs?.length > 0) {
      merged.contrastOutputs = cached.contrastOutputs;
    }

    if ((!merged.correctedScreenshots || merged.correctedScreenshots.length === 0) && cached.correctedScreenshots?.length > 0) {
      merged.correctedScreenshots = cached.correctedScreenshots;
    }
  }

  // Fallback: If still empty, check granular image keys in IndexedDB/Server
  if (merged.screenshots.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_screenshot_0`);
    if (single) merged.screenshots = [single];
  }
  if (merged.images.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_image_0`) || await getArtifact(`img_${sanitizedId}_figma_0`);
    if (single) merged.images = [single];
  }
  if (merged.appScreenshots.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_app_0`);
    if (single) merged.appScreenshots = [single];
  }
  if (merged.figmaImages.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_figma_0`);
    if (single) merged.figmaImages = [single];
  }
  if (!merged.correctedImage) {
    const single = await getArtifact(`img_${sanitizedId}_corrected`);
    if (single) merged.correctedImage = single;
  }
  if (merged.appScreenshots.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_app_0`);
    if (single) merged.appScreenshots = [single];
  }
  if (merged.figmaImages.length === 0) {
    const single = await getArtifact(`img_${sanitizedId}_figma_0`);
    if (single) merged.figmaImages = [single];
  }
  if (!merged.correctedImage) {
    const single = await getArtifact(`img_${sanitizedId}_corrected`);
    if (single) merged.correctedImage = single;
  }

  // Hydrate video playable URLs for merged.videos
  if (Array.isArray(merged.videos) && merged.videos.length > 0) {
    merged.videos = await Promise.all(
      merged.videos.map(async (v: any) => {
        if (!v) return v;
        const resolvedUrl = await resolveVideoPlayableUrl(v);
        return {
          ...v,
          url: resolvedUrl || v.url || ''
        };
      })
    );
  }

  // Hydrate video playable URLs for merged.appVideos
  if (Array.isArray(merged.appVideos) && merged.appVideos.length > 0) {
    merged.appVideos = await Promise.all(
      merged.appVideos.map(async (v: any) => {
        if (!v) return v;
        const resolvedUrl = await resolveVideoPlayableUrl(v);
        return {
          ...v,
          url: resolvedUrl || v.url || ''
        };
      })
    );
  }

  return merged;
}

/**
 * Hydrates all lists of UI Testing reports, reviews, comparisons, and inputs simultaneously.
 */
export async function hydrateAllReports(
  reports: any[] = [],
  reviews: any[] = [],
  comparisons: any[] = [],
  inputs: any[] = []
): Promise<{
  hydratedReports: any[];
  hydratedReviews: any[];
  hydratedComparisons: any[];
  hydratedInputs: any[];
}> {
  const [hydratedReports, hydratedReviews, hydratedComparisons, hydratedInputs] = await Promise.all([
    Promise.all((reports || []).map(r => hydrateReportArtifacts(r))),
    Promise.all((reviews || []).map(r => hydrateReportArtifacts(r))),
    Promise.all((comparisons || []).map(c => hydrateReportArtifacts(c))),
    Promise.all((inputs || []).map(i => hydrateReportArtifacts(i)))
  ]);

  return {
    hydratedReports,
    hydratedReviews,
    hydratedComparisons,
    hydratedInputs
  };
}
