"use strict";

(function(){
  const VIDEO_SPLIT_THRESHOLD_BYTES = 200 * 1024 * 1024;
  const VIDEO_SPLIT_TARGET_BYTES = 90 * 1024 * 1024;
  const FFMPEG_VENDOR_DIR = (() => {
    try {
      const scriptUrl = document.currentScript && document.currentScript.src ? document.currentScript.src : window.location.href;
      return new URL('../vendor/ffmpeg/', scriptUrl).href;
    } catch {
      return '../vendor/ffmpeg/';
    }
  })();
  const FFMPEG_ESM = `${FFMPEG_VENDOR_DIR}index.js`;
  const FFMPEG_WORKER_URL = `${FFMPEG_VENDOR_DIR}worker.js`;
  const FFMPEG_CORE_URL = `${FFMPEG_VENDOR_DIR}ffmpeg-core.js`;
  const FFMPEG_WASM_URL = `${FFMPEG_VENDOR_DIR}ffmpeg-core.wasm`;
  const INPUT_READ_CHUNK_BYTES = 16 * 1024 * 1024;

  let loadPromise = null;
  let ffmpegApi = null;
  let inputMountCounter = 0;
  const ffmpegLogListeners = new Set();

  function getExtension(file) {
    const name = file && typeof file.name === 'string' ? file.name : '';
    const match = name.match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : 'mp4';
  }

  function contentTypeForExtension(ext) {
    if (ext === 'webm') return 'video/webm';
    if (ext === 'mkv') return 'video/x-matroska';
    if (ext === 'mov') return 'video/quicktime';
    return 'video/mp4';
  }

  function isVideoFile(file) {
    if (!file) return false;
    const name = String(file.name || '');
    const type = String(file.type || '');
    return /^video\//i.test(type) || /\.(mp4|m4v|mov|webm|mkv|avi|flv|wmv|mpg|mpeg|ts|mts|m2ts|3gp|ogv)$/i.test(name);
  }

  function shouldRemuxToMp4(file) {
    if (!isVideoFile(file)) return false;
    const ext = getExtension(file);
    return ext !== 'mp4' && ext !== 'm4v';
  }

  function trimName(name) {
    return String(name || 'video')
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'video';
  }

  function shouldSplitVideo(file) {
    if (!file || typeof file.size !== 'number') return false;
    if (file.size <= VIDEO_SPLIT_THRESHOLD_BYTES) return false;
    return isVideoFile(file);
  }

  async function loadFfmpeg(onProgress) {
    if (ffmpegApi) return ffmpegApi;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (typeof onProgress === 'function') onProgress({ phase: 'load', ratio: 0, message: 'Loading FFmpeg' });
      const { FFmpeg } = await import(FFMPEG_ESM);
      const classWorkerURL = await buildLocalWrapperWorkerUrl();
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => {
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'split', ratio: Math.max(0, Math.min(1, Number(progress) || 0)) });
        }
      });
      ffmpeg.on('log', ({ message }) => {
        try { console.debug('[Creator] FFmpeg:', message); } catch {}
        ffmpegLogListeners.forEach((listener) => {
          try { listener(message); } catch {}
        });
      });
      await ffmpeg.load({
        classWorkerURL,
        coreURL: FFMPEG_CORE_URL,
        wasmURL: FFMPEG_WASM_URL
      });
      ffmpegApi = { ffmpeg };
      if (typeof onProgress === 'function') onProgress({ phase: 'load', ratio: 1, message: 'FFmpeg loaded' });
      return ffmpegApi;
    })();
    try {
      return await loadPromise;
    } catch (err) {
      loadPromise = null;
      throw err;
    }
  }

  async function buildLocalWrapperWorkerUrl() {
    try {
      const response = await fetch(FFMPEG_WORKER_URL, { cache: 'force-cache' });
      if (!response.ok && response.status !== 0) throw new Error(`Failed to load embedded FFmpeg worker (${response.status})`);
      const source = await response.text();
      const rewritten = source.replace(/from\s+["']\.\/([^"']+)["']/g, (_match, specifier) => {
        return `from "${FFMPEG_VENDOR_DIR}${specifier}"`;
      });
      return URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }));
    } catch (err) {
      try { console.warn('[Creator] Falling back to direct FFmpeg worker URL:', err); } catch {}
      return FFMPEG_WORKER_URL;
    }
  }

  function measureDuration(file) {
    const ext = getExtension(file);
    if (!file || !/^(mp4|m4v|mov|webm)$/i.test(ext)) return Promise.resolve(0);
    return new Promise((resolve) => {
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        const cleanup = () => {
          try { URL.revokeObjectURL(url); } catch {}
        };
        video.onloadedmetadata = () => {
          const duration = Number(video.duration);
          cleanup();
          resolve(Number.isFinite(duration) && duration > 0 ? duration : 0);
        };
        video.onerror = () => {
          cleanup();
          resolve(0);
        };
        video.src = url;
      } catch {
        resolve(0);
      }
    });
  }

  async function readBlobSliceBytes(blob, offset, end) {
    const slice = blob.slice(offset, end);
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return new Uint8Array(await slice.arrayBuffer());
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
      }
    }
    throw lastError || new Error('The I/O read operation failed.');
  }

  async function readFileBytes(file, onProgress) {
    if (!file || typeof file.slice !== 'function') {
      throw new Error('Selected video file could not be read.');
    }
    const size = Math.max(0, Number(file.size) || 0);
    const bytes = new Uint8Array(size);
    try {
      for (let offset = 0; offset < size; offset += INPUT_READ_CHUNK_BYTES) {
        const end = Math.min(size, offset + INPUT_READ_CHUNK_BYTES);
        bytes.set(await readBlobSliceBytes(file, offset, end), offset);
        if (typeof onProgress === 'function') {
          onProgress({ phase: 'read', ratio: end / Math.max(1, size), message: 'Preparing video' });
        }
      }
      return bytes;
    } catch (err) {
      throw new Error(`Selected video file could not be read: ${err && err.message ? err.message : String(err)}`);
    }
  }

  async function prepareInputFile(ffmpeg, file, fallbackInputName, onProgress) {
    const sourceName = file && file.name ? String(file.name).split(/[\\/]/).pop() : fallbackInputName;
    const mountPoint = `/input_${Date.now()}_${inputMountCounter += 1}`;
    try {
      try { await ffmpeg.createDir(mountPoint); } catch {}
      const mounted = await ffmpeg.mount('WORKERFS', { files: [file] }, mountPoint);
      if (mounted) {
        return {
          inputName: `${mountPoint}/${sourceName}`,
          cleanup: async () => {
            try { await ffmpeg.unmount(mountPoint); } catch {}
            try { await ffmpeg.deleteDir(mountPoint); } catch {}
          }
        };
      }
      try { await ffmpeg.deleteDir(mountPoint); } catch {}
    } catch (err) {
      try { await ffmpeg.unmount(mountPoint); } catch {}
      try { await ffmpeg.deleteDir(mountPoint); } catch {}
      try { console.warn('[Creator] FFmpeg WORKERFS input mount failed, falling back to byte copy:', err); } catch {}
    }

    await ffmpeg.writeFile(fallbackInputName, await readFileBytes(file, onProgress));
    return {
      inputName: fallbackInputName,
      cleanup: async () => {
        try { await ffmpeg.deleteFile(fallbackInputName); } catch {}
      }
    };
  }

  function parseFfmpegDurationLine(message) {
    const match = String(message || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) return 0;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const duration = (hours * 3600) + (minutes * 60) + seconds;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  async function measureDurationFromFfmpegInput(ffmpeg, inputName) {
    let duration = 0;
    const listener = (message) => {
      if (duration) return;
      duration = parseFfmpegDurationLine(message);
    };
    ffmpegLogListeners.add(listener);
    try {
      await ffmpeg.exec(['-i', inputName]);
    } catch {
      // `ffmpeg -i file` exits with an error after printing stream metadata.
    } finally {
      ffmpegLogListeners.delete(listener);
    }
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  function isTextSubtitleCodec(codecName) {
    return /^(ass|ssa|subrip|srt|text|webvtt|mov_text)$/i.test(String(codecName || ''));
  }

  async function inspectInputStreams(ffmpeg, inputName) {
    const outputName = `probe_${Date.now()}_${Math.random().toString(16).slice(2)}.json`;
    try {
      await ffmpeg.ffprobe([
        '-v', 'error',
        '-show_entries', 'stream=index,codec_type,codec_name',
        '-of', 'json',
        inputName,
        '-o', outputName
      ]);
      const text = await ffmpeg.readFile(outputName, 'utf8');
      const parsed = JSON.parse(String(text || '{}'));
      const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
      const video = streams.find((stream) => stream && stream.codec_type === 'video');
      const audio = streams.filter((stream) => stream && stream.codec_type === 'audio');
      const subtitles = streams.filter((stream) => {
        return stream && stream.codec_type === 'subtitle' && isTextSubtitleCodec(stream.codec_name);
      });
      const result = {
        videoIndex: video && Number.isFinite(Number(video.index)) ? Number(video.index) : null,
        audioIndexes: audio
          .map((stream) => Number(stream.index))
          .filter((index) => Number.isFinite(index)),
        subtitleIndexes: subtitles
          .map((stream) => Number(stream.index))
          .filter((index) => Number.isFinite(index))
      };
      try { console.debug('[Creator] FFmpeg stream plan:', result); } catch {}
      return result;
    } catch (err) {
      try { console.warn('[Creator] FFmpeg stream probe failed, using default MP4 stream map:', err); } catch {}
      return null;
    } finally {
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  async function inspectVideoFileStreams(file, options = {}) {
    if (!isVideoFile(file)) return null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const ext = getExtension(file);
    const fallbackInputName = `probe_input.${ext}`;
    const { ffmpeg } = await loadFfmpeg(onProgress);
    const input = await prepareInputFile(ffmpeg, file, fallbackInputName, onProgress);
    try {
      return await inspectInputStreams(ffmpeg, input.inputName);
    } finally {
      await input.cleanup();
    }
  }

  function streamMapArgs(streams) {
    if (!streams || !Number.isFinite(Number(streams.videoIndex))) {
      return ['-map', '0:v:0', '-map', '0:a?'];
    }
    const args = ['-map', `0:${Number(streams.videoIndex)}`];
    const audioIndexes = Array.isArray(streams.audioIndexes) ? streams.audioIndexes : [];
    audioIndexes.forEach((index) => {
      if (Number.isFinite(Number(index))) args.push('-map', `0:${Number(index)}`);
    });
    const subtitleIndexes = Array.isArray(streams.subtitleIndexes) ? streams.subtitleIndexes : [];
    subtitleIndexes.forEach((index) => {
      if (Number.isFinite(Number(index))) args.push('-map', `0:${Number(index)}`);
    });
    return args;
  }

  function mp4StreamArgs(videoCodec, streams) {
    const hasTextSubtitles = streams && Array.isArray(streams.subtitleIndexes) && streams.subtitleIndexes.length > 0;
    const args = [
      ...streamMapArgs(streams),
      '-dn',
      '-map_chapters', '-1',
      '-map_metadata', '-1',
      '-c:v', videoCodec,
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero'
    ];
    if (hasTextSubtitles) {
      args.push('-c:s', 'mov_text');
    } else {
      args.push('-sn');
    }
    return args;
  }

  async function splitVideoFile(file, options = {}) {
    if (!shouldSplitVideo(file)) {
      return { didSplit: false, parts: [{ file, durationSeconds: await measureDuration(file) }] };
    }

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let duration = await measureDuration(file);
    const ext = getExtension(file);
    const baseName = trimName(file.name);
    const fallbackInputName = `input.${ext}`;
    const { ffmpeg } = await loadFfmpeg(onProgress);

    if (onProgress) onProgress({ phase: 'write', ratio: 0, message: 'Preparing video' });
    const input = await prepareInputFile(ffmpeg, file, fallbackInputName, onProgress);
    const inputName = input.inputName;
    if (onProgress) onProgress({ phase: 'write', ratio: 1, message: 'Video prepared' });

    const parts = [];
    let splitCount = 0;
    try {
      if (!duration) duration = await measureDurationFromFfmpegInput(ffmpeg, inputName);
      if (!duration) throw new Error('Could not read video duration for splitting.');
      const streams = await inspectInputStreams(ffmpeg, inputName);

      splitCount = Math.max(2, Math.ceil(file.size / VIDEO_SPLIT_TARGET_BYTES));
      const partDuration = duration / splitCount;
      for (let index = 0; index < splitCount; index += 1) {
        const start = index * partDuration;
        const length = index === splitCount - 1 ? duration - start : partDuration;
        const outputName = `${baseName}_part_${String(index + 1).padStart(2, '0')}.mp4`;
        if (onProgress) {
          onProgress({
            phase: 'split',
            ratio: index / splitCount,
            partIndex: index + 1,
            partCount: splitCount,
            message: `Splitting part ${index + 1} of ${splitCount}`
          });
        }
        const copyArgs = [
          '-ss', String(Math.max(0, start)),
          '-t', String(Math.max(0.1, length)),
          '-i', inputName,
          ...mp4StreamArgs('copy', streams),
          outputName
        ];
        try {
          await ffmpeg.exec(copyArgs);
        } catch (err) {
          try { await ffmpeg.deleteFile(outputName); } catch {}
          await ffmpeg.exec([
            '-ss', String(Math.max(0, start)),
            '-t', String(Math.max(0.1, length)),
            '-i', inputName,
            ...mp4StreamArgs('libx264', streams),
            '-preset', 'veryfast',
            '-crf', '23',
            outputName
          ]);
        }
        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data], { type: 'video/mp4' });
        parts.push({
          file: new File([blob], outputName, { type: blob.type, lastModified: Date.now() }),
          durationSeconds: length
        });
        try { await ffmpeg.deleteFile(outputName); } catch {}
      }
    } finally {
      await input.cleanup();
    }

    if (onProgress) onProgress({ phase: 'split', ratio: 1, partIndex: splitCount, partCount: splitCount, message: 'Split complete' });
    return { didSplit: true, durationSeconds: duration, parts };
  }

  async function remuxVideoFileToMp4(file, options = {}) {
    if (!shouldRemuxToMp4(file)) return { didRemux: false, file, durationSeconds: await measureDuration(file) };

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    let duration = await measureDuration(file);
    const ext = getExtension(file);
    const baseName = trimName(file.name);
    const fallbackInputName = `input.${ext}`;
    const outputName = `${baseName}.mp4`;
    const { ffmpeg } = await loadFfmpeg(onProgress);

    if (onProgress) onProgress({ phase: 'write', ratio: 0, message: 'Preparing video' });
    const input = await prepareInputFile(ffmpeg, file, fallbackInputName, onProgress);
    const inputName = input.inputName;
    if (onProgress) onProgress({ phase: 'write', ratio: 1, message: 'Video prepared' });

    try {
      if (!duration) duration = await measureDurationFromFfmpegInput(ffmpeg, inputName);
      const streams = await inspectInputStreams(ffmpeg, inputName);
      if (onProgress) onProgress({ phase: 'remux', ratio: 0, message: 'Remuxing video' });
      try {
        await ffmpeg.exec([
          '-i', inputName,
          ...mp4StreamArgs('copy', streams),
          outputName
        ]);
      } catch (err) {
        try { await ffmpeg.deleteFile(outputName); } catch {}
        await ffmpeg.exec([
        '-i', inputName,
        ...mp4StreamArgs('libx264', streams),
        '-preset', 'veryfast',
        '-crf', '23',
        outputName
        ]);
      }
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data], { type: 'video/mp4' });
      if (onProgress) onProgress({ phase: 'remux', ratio: 1, message: 'Remux complete' });
      return {
        didRemux: true,
        file: new File([blob], outputName, { type: 'video/mp4', lastModified: Date.now() }),
        durationSeconds: duration
      };
    } finally {
      try { await ffmpeg.deleteFile(outputName); } catch {}
      await input.cleanup();
    }
  }

  window.mmIsVideoFileForFfmpeg = isVideoFile;
  window.mmShouldRemuxVideoFileToMp4 = shouldRemuxToMp4;
  window.mmInspectVideoFileStreamsWithFfmpeg = inspectVideoFileStreams;
  window.mmRemuxVideoFileToMp4 = remuxVideoFileToMp4;
  window.mmShouldSplitVideoFile = shouldSplitVideo;
  window.mmSplitVideoFileWithFfmpeg = splitVideoFile;
  window.mmVideoSplitThresholdBytes = VIDEO_SPLIT_THRESHOLD_BYTES;
})();
