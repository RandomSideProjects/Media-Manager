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
      // Optimize for multithreading if the browser supports SharedArrayBuffer
      const coreOptions = {
        classWorkerURL,
        coreURL: FFMPEG_CORE_URL,
        wasmURL: FFMPEG_WASM_URL
      };
      
      // If the browser supports it, this is significantly faster
      if (typeof SharedArrayBuffer !== 'undefined') {
        try { coreOptions.workerLoadURL = FFMPEG_WORKER_URL; } catch {}
      }

      await ffmpeg.load(coreOptions);
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

  function normalizeRemuxMode(mode) {
    return String(mode || '').trim().toLowerCase() === 'compatible' ? 'compatible' : 'fast';
  }

  function isMp4CopySafeVideoCodec(codecName) {
    return /^(h264|avc1|hevc|h265|av1|mpeg4)$/i.test(String(codecName || ''));
  }

  function isCompatibleCopyVideoCodec(codecName) {
    return /^(h264|avc1)$/i.test(String(codecName || ''));
  }

  function isMp4CopySafeAudioCodec(codecName) {
    return /^(aac|alac|ac3|eac3|mp3)$/i.test(String(codecName || ''));
  }

  async function inspectInputStreams(ffmpeg, inputName) {
    try {
      if (typeof ffmpeg.ffprobe === 'function') {
        const outputName = `probe_${Date.now()}.json`;
        try {
          await ffmpeg.ffprobe([
            '-v', 'error',
            '-show_entries', 'stream=index,codec_type,codec_name,bit_rate:stream_tags=language',
            '-of', 'json',
            inputName,
            '-o', outputName
          ]);
          const text = await ffmpeg.readFile(outputName, 'utf8');
          const parsed = JSON.parse(String(text || '{}'));
          const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
          const video = streams.find((s) => s && s.codec_type === 'video');
          const audio = streams.filter((s) => s && s.codec_type === 'audio');
          const subtitles = streams.filter((s) => s && s.codec_type === 'subtitle');
          return {
            videoIndex: video && Number.isFinite(Number(video.index)) ? Number(video.index) : null,
            videoCodec: video ? String(video.codec_name).toLowerCase() : null,
            videoBitrate: video && Number.isFinite(Number(video.bit_rate)) ? Math.round(Number(video.bit_rate)) : null,
            audioStreams: audio.map((a) => ({
              index: Number(a.index),
              codec: String(a.codec_name).toLowerCase(),
              bitrate: Number.isFinite(Number(a.bit_rate)) ? Math.round(Number(a.bit_rate)) : null,
              lang: (a.tags && (a.tags.language || a.tags.LANGUAGE)) || null
            })),
            subtitleStreams: subtitles.map((s) => ({
              index: Number(s.index),
              codec: String(s.codec_name).toLowerCase(),
              isText: isTextSubtitleCodec(s.codec_name),
              lang: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || null
            }))
          };
        } finally {
          try { await ffmpeg.deleteFile(outputName); } catch {}
        }
      }

      // Fallback: Parse ffmpeg -i output
      let output = '';
      const listener = (msg) => { output += msg + '\n'; };
      ffmpegLogListeners.add(listener);
      try {
        await ffmpeg.exec(['-i', inputName]);
      } catch {
        // -i exits with error generally
      } finally {
        ffmpegLogListeners.delete(listener);
      }

      const videoMatch = output.match(/Stream #\d+:(\d+).*?Video: ([a-z0-9]+)/i);
      const bitrateMatch = output.match(/bitrate: (\d+) kb\/s/i);
      
      return {
        videoIndex: videoMatch ? Number(videoMatch[1]) : 0,
        videoCodec: videoMatch ? videoMatch[2].toLowerCase() : null,
        videoBitrate: bitrateMatch ? Number(bitrateMatch[1]) * 1000 : null,
        audioStreams: [], 
        subtitleStreams: [] 
      };
    } catch (err) {
      try { console.warn('[Creator] FFmpeg stream probe failed:', err); } catch {}
      return null;
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

    const audioStreams = Array.isArray(streams.audioStreams) ? streams.audioStreams : [];
    const engAudio = audioStreams.find(s => {
      const l = String(s.lang || '').toLowerCase();
      return l === 'eng' || l === 'en' || l === 'english';
    });
    
    if (engAudio) {
      // If English audio is found, map it first
      args.push('-map', `0:${Number(engAudio.index)}`);
      audioStreams.forEach((s) => {
        if (s && s.index !== engAudio.index && Number.isFinite(Number(s.index))) {
          args.push('-map', `0:${Number(s.index)}`);
        }
      });
    } else {
      audioStreams.forEach((s) => {
        if (s && Number.isFinite(Number(s.index))) args.push('-map', `0:${Number(s.index)}`);
      });
    }

    const subtitleStreams = Array.isArray(streams.subtitleStreams) ? streams.subtitleStreams : [];
    const textSubtitles = subtitleStreams.filter(s => s.isText);
    const engSub = textSubtitles.find(s => {
      const l = String(s.lang || '').toLowerCase();
      return l === 'eng' || l === 'en' || l === 'english';
    });

    if (engSub) {
      // Map English text subtitle first
      args.push('-map', `0:${Number(engSub.index)}`);
      textSubtitles.forEach((s) => {
        if (s && s.index !== engSub.index && Number.isFinite(Number(s.index))) {
          args.push('-map', `0:${Number(s.index)}`);
        }
      });
    } else {
      textSubtitles.forEach((s) => {
        if (s && Number.isFinite(Number(s.index))) args.push('-map', `0:${Number(s.index)}`);
      });
    }

    return args;
  }

  function mp4StreamArgs(streams, options = {}) {
    const forceReencode = options.forceReencode === true;
    const remuxMode = normalizeRemuxMode(options.remuxMode);
    const videoCodec = streams && streams.videoCodec;
    const videoBitrate = streams && streams.videoBitrate;
    const isSupportedVideo = !forceReencode && (
      remuxMode === 'fast'
        ? isMp4CopySafeVideoCodec(videoCodec)
        : isCompatibleCopyVideoCodec(videoCodec)
    );
    const vCodecArg = isSupportedVideo ? 'copy' : 'libx264';

    const args = [
      ...streamMapArgs(streams),
      '-dn',
      '-map_chapters', '-1',
      '-map_metadata', '-1',
      '-c:v', vCodecArg
    ];

    if (vCodecArg === 'copy' && /^(hevc|h265)$/i.test(String(videoCodec || ''))) {
      args.push('-tag:v', 'hvc1');
    }

    if (vCodecArg === 'libx264') {
      // ultrafast + zerolatency for maximum speed in WASM environment
      args.push('-preset', 'ultrafast', '-tune', 'zerolatency');
      if (videoBitrate && videoBitrate > 0) {
        // Use a slightly more aggressive buffer for WASM stability
        args.push('-b:v', `${Math.round(videoBitrate)}`, '-maxrate', `${Math.round(videoBitrate * 2)}`, '-bufsize', `${Math.round(videoBitrate * 4)}`);
      } else {
        args.push('-crf', '24'); // Slightly lower quality for significantly faster encode
      }
      // Threads 0 allows FFmpeg to use all available WebWorker cores
      args.push('-pix_fmt', 'yuv420p', '-threads', '0');
    }

    // Audio handling: re-encode to aac unless already aac/mp3
    const audioStreams = (streams && Array.isArray(streams.audioStreams)) ? streams.audioStreams : [];
    if (audioStreams.length > 0) {
      audioStreams.forEach((s, idx) => {
        const isSupportedAudio = !forceReencode && isMp4CopySafeAudioCodec(s.codec);
        args.push(`-c:a:${idx}`, isSupportedAudio ? 'copy' : 'aac');
        if (!isSupportedAudio) {
          if (s.bitrate && s.bitrate > 0) {
            args.push(`-b:a:${idx}`, `${Math.round(s.bitrate)}`);
          } else {
            args.push(`-b:a:${idx}`, '128k');
          }
        }
      });
    } else {
      args.push('-an');
    }

    // Subtitle handling: only keep text subtitles, convert to mov_text
    const textSubtitles = (streams && Array.isArray(streams.subtitleStreams)) ? streams.subtitleStreams.filter(s => s.isText) : [];
    if (textSubtitles.length > 0) {
      textSubtitles.forEach((s, idx) => {
        args.push(`-c:s:${idx}`, 'mov_text');
      });
    } else {
      args.push('-sn');
    }

    args.push('-movflags', '+faststart', '-avoid_negative_ts', 'make_zero');
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
        const procArgs = [
          '-ss', String(Math.max(0, start)),
          '-t', String(Math.max(0.1, length)),
          '-i', inputName,
          ...mp4StreamArgs(streams, { remuxMode: options.remuxMode }),
          outputName
        ];
        try {
          await ffmpeg.exec(procArgs);
        } catch (err) {
          try { console.warn('[Creator] FFmpeg partial split failed, retrying with force re-encode:', err); } catch {}
          try { await ffmpeg.deleteFile(outputName); } catch {}
          await ffmpeg.exec([
            '-ss', String(Math.max(0, start)),
            '-t', String(Math.max(0.1, length)),
            '-i', inputName,
            ...mp4StreamArgs(streams, { remuxMode: options.remuxMode, forceReencode: true }),
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
    if (!shouldRemuxToMp4(file) && options.forceRemux !== true) {
      return { didRemux: false, file, durationSeconds: await measureDuration(file) };
    }
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
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
      let duration = await measureDuration(file);
      if (!duration) duration = await measureDurationFromFfmpegInput(ffmpeg, inputName);
      const streams = await inspectInputStreams(ffmpeg, inputName);
      if (onProgress) onProgress({ phase: 'remux', ratio: 0, message: 'Remuxing video' });
      try {
        await ffmpeg.exec([
          '-i', inputName,
          ...mp4StreamArgs(streams, { remuxMode: options.remuxMode }),
          outputName
        ]);
      } catch (err) {
        try { console.warn('[Creator] FFmpeg remux failed, retrying with force re-encode:', err); } catch {}
        try { await ffmpeg.deleteFile(outputName); } catch {}
        await ffmpeg.exec([
          '-i', inputName,
          ...mp4StreamArgs(streams, { remuxMode: options.remuxMode, forceReencode: true }),
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
