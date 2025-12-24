"use strict";

/**
 * Overlay Factory - Creates UI overlays and modals dynamically
 * This module provides functions to create overlays on demand instead of pre-embedding them in HTML
 */

window.OverlayFactory = (function() {
  
  // Helper to create element with attributes and children
  function createElement(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'className') el.className = value;
      else if (key === 'innerHTML') el.innerHTML = value;
      else if (key === 'textContent') el.textContent = value;
      else if (key.startsWith('data-')) el.setAttribute(key, value);
      else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else {
        el.setAttribute(key, value);
      }
    });
    children.forEach(child => {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else if (child) el.appendChild(child);
    });
    return el;
  }

  // Remove overlay by ID
  function removeOverlay(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Create settings overlay for main page
  function createSettingsOverlay() {
    removeOverlay('settingsOverlay');
    
    const clippingSection = createElement('div', { className: 'setting-category' }, [
      createElement('div', { className: 'setting-category-header' }, ['Clipping']),
      createElement('div', { className: 'setting-row' }, [
        createElement('input', { type: 'checkbox', id: 'clipToggle' }),
        createElement('label', { for: 'clipToggle' }, ['Enable clipping'])
      ]),
      createElement('div', { className: 'setting-row' }, [
        createElement('input', { type: 'checkbox', id: 'clipPreviewToggle' }),
        createElement('label', { for: 'clipPreviewToggle', 'data-setting-tag': 'beta' }, ['Clip preview'])
      ]),
      createElement('div', { className: 'setting-row' }, [
        createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
          createElement('input', { type: 'checkbox', id: 'clipLocalModeToggle' }),
          createElement('label', { for: 'clipLocalModeToggle' }, ['Local clipping only'])
        ]),
        createElement('small', {}, ['Skip the clip API and keep the capture process on-device.'])
      ])
    ]);

    const downloadsSection = createElement('div', { className: 'setting-category' }, [
      createElement('div', { className: 'setting-category-header' }, ['Downloads']),
      createElement('div', { className: 'setting-row' }, [
        createElement('input', { type: 'checkbox', id: 'selectiveDownloadToggle' }),
        createElement('label', { for: 'selectiveDownloadToggle', 'data-setting-tag': 'beta' }, ['Selective downloads'])
      ]),
      createElement('div', { className: 'setting-row' }, [
        createElement('label', { for: 'downloadConcurrencyRange' }, ['Download concurrency']),
        createElement('input', { type: 'range', id: 'downloadConcurrencyRange', min: '1', max: '8', step: '1', value: '2' }),
        createElement('span', { id: 'downloadConcurrencyValue' }, ['2'])
      ])
    ]);
    
    const overlay = createElement('div', { id: 'settingsOverlay' }, [
      createElement('div', { id: 'settingsPanel' }, [
        createElement('div', { className: 'setting-row' }, [
          createElement('h3', {}, ['Settings']),
          createElement('button', { id: 'settingsCloseBtn' }, ['Close'])
        ]),
        clippingSection,
        downloadsSection,
        createElement('div', { className: 'setting-category' }, [
          createElement('div', { className: 'setting-category-header' }, ['General']),
          createElement('div', { className: 'setting-row recent-sources-setting' }, [
            createElement('div', { className: 'recent-sources-label' }, [
              createElement('span', { 'data-setting-tag': 'beta' }, ['Recent sources']),
              createElement('small', {}, ['Show your last loaded sources on the home screen.'])
            ]),
            createElement('div', { className: 'recent-sources-controls' }, [
              createElement('input', { type: 'checkbox', id: 'recentSourcesToggle', 'aria-label': 'Enable recent sources' }),
              createElement('select', { id: 'recentSourcesPlacement', 'aria-label': 'Recent sources placement' }, [
                createElement('option', { value: 'bottom' }, ['Bottom']),
                createElement('option', { value: 'left' }, ['Left']),
                createElement('option', { value: 'right' }, ['Right'])
              ])
            ])
          ])
        ]),
        createElement('div', { className: 'setting-category' }, [
          createElement('div', { className: 'setting-category-header' }, ['Storage']),
          createElement('div', { className: 'setting-row' }, [
            createElement('input', { type: 'checkbox', id: 'storageShowCameraOptionsToggle' }),
            createElement('label', { for: 'storageShowCameraOptionsToggle' }, ['Show camera options (QR import)'])
          ]),
          createElement('small', { style: { opacity: '.7', marginTop: '4px', display: 'block' } }, [
            'If enabled, the QR scanner will list available cameras so you can pick one.'
          ])
        ]),
        createElement('div', { className: 'setting-category' }, [
          createElement('div', { className: 'setting-category-header' }, ['Theater']),
          createElement('div', { className: 'setting-row' }, [
            createElement('label', { for: 'popoutToolbarPlacement' }, ['Pop-out toolbar placement']),
            createElement('select', { id: 'popoutToolbarPlacement', 'aria-label': 'Pop-out toolbar placement' }, [
              createElement('option', { value: 'bottom' }, ['Bottom']),
              createElement('option', { value: 'left' }, ['Left']),
              createElement('option', { value: 'right' }, ['Right'])
            ])
          ]),
          createElement('small', { style: { opacity: '.7', marginTop: '4px', display: 'block' } }, [
            'Choose where the pop-out toolbar should appear when you move your mouse near the screen edge.'
          ])
        ]),
        createElement('div', { className: 'setting-row' }, [
          createElement('div', { className: 'storage-menu' }, [
            createElement('button', { id: 'storageMenuBtn', type: 'button' }, ['Storage']),
            createElement('div', { id: 'storageMenuPanel', className: 'storage-menu-panel', role: 'menu', 'aria-hidden': 'true' }, [
              createElement('button', { id: 'storageDeleteBtn', type: 'button', className: 'danger-button storage-menu-item' }, ['Delete storage']),
              createElement('button', { id: 'storageExportBtn', type: 'button', className: 'storage-menu-item' }, ['Export']),
              createElement('button', { id: 'storageImportBtn', type: 'button', className: 'storage-menu-item' }, ['Import'])
            ])
          ])
        ]),
        createElement('div', { className: 'setting-row', id: 'devMenuRow', style: { display: 'none' }, 'data-setting-tag': 'dev' }, [
          createElement('button', { id: 'devMenuBtn', type: 'button' }, ['Dev Menu']),
          createElement('span', { className: 'dev-menu-status', id: 'devMenuStatus' }, ['Developer tools'])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create clear storage confirmation overlay
  function createClearStorageOverlay() {
    removeOverlay('clearStorageOverlay');
    
    const overlay = createElement('div', { id: 'clearStorageOverlay' }, [
      createElement('div', { id: 'clearStoragePanel' }, [
        createElement('div', { className: 'setting-row' }, [
          createElement('h3', {}, ['Confirm Clear Storage'])
        ]),
        createElement('p', {}, ['This will remove all saved progress, preferences, and cached data for this app. This cannot be undone.']),
        createElement('div', { className: 'setting-row' }, [
          createElement('button', { id: 'clearStorageConfirmBtn', className: 'danger-button' }, ['Yes, clear storage']),
          createElement('button', { id: 'clearStorageCancelBtn' }, ['Cancel'])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create storage import overlay
  function createStorageImportOverlay() {
    removeOverlay('storageImportOverlay');
    
    const overlay = createElement('div', { id: 'storageImportOverlay' }, [
      createElement('div', { id: 'storageImportPanel' }, [
        createElement('div', { className: 'setting-row' }, [
          createElement('h3', {}, ['Import Settings'])
        ]),
        createElement('p', {}, ['Select a Catbox code or JSON file to load settings.']),
        createElement('label', { for: 'storageImportCodeInput', className: 'import-label' }, ['Catbox code or URL']),
        createElement('div', { className: 'import-code-row' }, [
          createElement('input', { id: 'storageImportCodeInput', type: 'text', placeholder: 'abc123 or https://files.catbox.moe/abc123.json' }),
          createElement('button', {
            id: 'storageImportScanBtn',
            type: 'button',
            className: 'scanner-launcher',
            title: 'Scan Catbox QR code',
            'aria-label': 'Scan Catbox QR code using camera'
          }, ['Scan QR'])
        ]),
        createElement('div', { className: 'import-divider' }, ['or']),
        createElement('label', { for: 'storageImportFileInput', className: 'import-label' }, ['Import JSON file']),
        createElement('input', { id: 'storageImportFileInput', type: 'file', accept: 'application/json' }),
        createElement('div', { id: 'storageImportActionsRow', className: 'setting-row import-actions' }, [
          createElement('button', { id: 'storageImportConfirmBtn', type: 'button' }, ['Import']),
          createElement('button', { id: 'storageImportCancelBtn', type: 'button' }, ['Cancel'])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  function createStorageImportScanOverlay() {
    removeOverlay('storageImportScanOverlay');

    const overlay = createElement('div', { id: 'storageImportScanOverlay' }, [
      createElement('div', { id: 'storageImportScanPanel' }, [
        createElement('button', {
          id: 'storageImportScanCloseBtn',
          type: 'button',
          className: 'overlay-close',
          'aria-label': 'Close QR scanner'
        }, ['✕']),
        createElement('h3', {}, ['Scan QR Code']),
        createElement('p', {}, ['Point your device camera at a Catbox export QR to load settings quickly.']),
        createElement('div', { className: 'scanner-video-wrap' }, [
          createElement('video', {
            id: 'storageImportScanVideo',
            muted: '',
            playsinline: ''
          }),
          createElement('div', { className: 'scanner-target' })
        ]),
        createElement('canvas', { id: 'storageImportScanCanvas', hidden: '' }),
        createElement('div', {
          id: 'storageImportCameraSelectRow',
          className: 'scanner-camera-row',
          style: { display: 'none', gap: '0.5em', alignItems: 'center' }
        }, [
          createElement('label', { for: 'storageImportCameraSelect' }, ['Camera']),
          createElement('select', { id: 'storageImportCameraSelect' }, [])
        ]),
        createElement('div', { id: 'storageImportScanMessage' }, ['Looking for a QR code...'])
      ])
    ]);

    document.body.appendChild(overlay);
    return overlay;
  }

  // Create clip preset overlay
  function createClipPresetOverlay() {
    removeOverlay('clipPresetOverlay');
    
    const overlay = createElement('div', { id: 'clipPresetOverlay' }, [
      createElement('div', { id: 'clipPresetContent' }, [
        createElement('h3', {}, ['Select Clip Length']),
        createElement('div', { id: 'clipPresetButtons' }),
        createElement('div', { className: 'clip-custom-row' }, [
          createElement('div', { className: 'trim-slider', id: 'trimSlider' }, [
            createElement('div', { className: 'trim-track' }),
            createElement('div', { className: 'trim-range', id: 'trimRange' }),
            createElement('button', { className: 'trim-handle', id: 'trimHandleStart', type: 'button', 'aria-label': 'Clip start' }),
            createElement('button', { className: 'trim-handle', id: 'trimHandleEnd', type: 'button', 'aria-label': 'Clip end' }),
            createElement('div', { className: 'trim-mark', id: 'trimPreviewMarker' })
          ]),
          createElement('div', { className: 'clip-custom-controls' }, [
            createElement('div', { className: 'trim-display' }, [
              createElement('span', {}, ['Start: ', createElement('span', { id: 'clipDisplayStart' }, ['00:00'])]),
              createElement('span', {}, ['End: ', createElement('span', { id: 'clipDisplayEnd' }, ['00:20'])]),
              createElement('span', {}, ['Length: ', createElement('span', { id: 'clipDisplayLength' }, ['00:20'])])
            ]),
            createElement('button', { id: 'clipCustomStartBtn', type: 'button' }, ['Start'])
          ]),
          createElement('small', { className: 'clip-custom-hint' }, ['Drag handles to choose the clip window.'])
        ]),
        createElement('label', { className: 'clip-remember-row' }, [
          createElement('input', { type: 'checkbox', id: 'clipRememberPreset' }),
          createElement('span', {}, ['Remember last selection'])
        ]),
        createElement('div', { id: 'clipHistorySection' }, [
          createElement('div', { className: 'clip-history-header' }, [
            createElement('h4', {}, ['Recent Clips']),
            createElement('button', { id: 'clipHistoryClearBtn', type: 'button' }, ['Clear'])
          ]),
          createElement('div', { id: 'clipHistoryList' })
        ]),
        createElement('button', { id: 'clipPresetCloseBtn', type: 'button', className: 'overlay-close', 'aria-label': 'Close clip presets' }, ['✕'])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create clip overlay
  function createClipOverlay() {
    removeOverlay('clipOverlay');
    
    const overlay = createElement('div', { id: 'clipOverlay' }, [
      createElement('div', { id: 'clipOverlayContent' }, [
        createElement('button', { id: 'clipOverlayCloseBtn', className: 'overlay-close', type: 'button', 'aria-label': 'Close clip dialog' }, ['✕']),
        createElement('div', { id: 'clipMessage' }),
        createElement('div', { id: 'clipButtonsRow' }, [
          createElement('button', { id: 'clipDoneBtn' }, ['Done']),
          createElement('button', { id: 'clipDownloadBtn' }, ['Download'])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create clip progress overlay
  function createClipProgressOverlay() {
    removeOverlay('clipProgressOverlay');
    
    const overlay = createElement('div', { id: 'clipProgressOverlay' }, [
      createElement('div', { id: 'clipProgressContent' }, [
        createElement('p', { id: 'clipProgressMessage' }),
        createElement('progress', { id: 'clipProgressBar', max: '100', value: '0' })
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create CBZ progress overlay
  function createCbzProgressOverlay() {
    removeOverlay('cbzProgressOverlay');
    
    const overlay = createElement('div', { id: 'cbzProgressOverlay' }, [
      createElement('div', { id: 'cbzProgressContent' }, [
        createElement('div', { id: 'cbzProgressHeader' }, [
          createElement('p', { id: 'cbzProgressMessage' }, ['Preparing…']),
          createElement('div', { id: 'cbzInfoWrap', className: 'cbz-info-wrap', 'aria-describedby': 'cbzInfoTooltip' }, [
            createElement('button', { id: 'cbzInfoBtn', type: 'button', title: 'Why does this take time?', 'aria-label': 'Why does this take time?' }, ['i']),
            createElement('div', { id: 'cbzInfoTooltip', className: 'cbz-info-tooltip', role: 'tooltip' }, [
              'Due to the way we store pages (in cbz/zip files), we have to load the entire set at once. we apologize for the inconvenience.'
            ])
          ])
        ]),
        createElement('progress', { id: 'cbzProgressBar', max: '100', value: '0' })
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create sources settings overlay (for Sources page)
  function createSourcesSettingsOverlay() {
    removeOverlay('sourcesSettingsOverlay');
    
    const overlay = createElement('div', { id: 'sourcesSettingsOverlay' }, [
      createElement('div', { id: 'sourcesSettingsPanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sourcesSettingsTitle' }, [
        createElement('h3', { id: 'sourcesSettingsTitle' }, ['Public Sources — Settings']),
        createElement('div', { className: 'section' }, [
          createElement('div', { className: 'settings-row' }, [createElement('strong', {}, ['Sort by'])]),
          createElement('div', { className: 'settings-radio', id: 'sortOptions' }, [
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'sort', value: 'az' }), ' A–Z']),
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'sort', value: 'za' }), ' Z–A']),
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'sort', value: 'newold' }), ' New → Old']),
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'sort', value: 'oldnew' }), ' Old → New']),
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'sort', value: 'recent' }), ' Last opened'])
          ])
        ]),
        createElement('div', { className: 'section' }, [
          createElement('label', { className: 'settings-row', style: { justifyContent: 'space-between' } }, [
            createElement('span', {}, ['Hide posters']),
            createElement('input', { type: 'checkbox', id: 'toggleHidePosters' })
          ])
        ]),
        createElement('div', { className: 'section' }, [
          createElement('label', { className: 'settings-row', style: { justifyContent: 'space-between' } }, [
            createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              createElement('span', {}, ['Enable search bar']),
              createElement('span', { 'data-setting-tag': 'beta' })
            ]),
            createElement('input', { type: 'checkbox', id: 'toggleSearchBar' })
          ])
        ]),
        createElement('div', { className: 'section' }, [
          createElement('div', { className: 'settings-row', style: { justifyContent: 'space-between', width: '100%' } }, [
            createElement('span', {}, ['Row Limit']),
            createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
              createElement('input', { type: 'range', id: 'rowLimitRange', min: '2', max: '10', step: '1', value: '3' }),
              createElement('span', { id: 'rowLimitValue' }, ['3'])
            ])
          ])
        ]),
        createElement('div', { className: 'section' }, [
          createElement('div', { className: 'settings-row' }, [createElement('strong', {}, ['Library'])]),
          createElement('div', { className: 'settings-radio', id: 'modeOptions' }, [
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'mode', value: 'anime' }), ' Anime']),
            createElement('label', {}, [createElement('input', { type: 'radio', name: 'mode', value: 'manga' }), ' Manga'])
          ])
        ]),
        createElement('div', { className: 'settings-actions' }, [
          createElement('button', { id: 'settingsCancel', className: 'btn-ghost' }, ['Close']),
          createElement('button', { id: 'settingsApply', className: 'btn-primary' }, ['Apply']),
          createElement('button', { id: 'openFeedback', className: 'btn-primary', style: { marginLeft: 'auto' } }, ['Feedback & Bugs'])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create feedback overlay
  function createFeedbackOverlay() {
    removeOverlay('feedbackOverlay');
    
    const overlay = createElement('div', { 
      id: 'feedbackOverlay', 
      style: { 
        display: 'none', 
        position: 'fixed', 
        inset: '0', 
        background: 'rgba(0,0,0,0.6)', 
        alignItems: 'center', 
        justifyContent: 'center', 
        zIndex: '1002' 
      } 
    }, [
      createElement('div', { 
        id: 'feedbackPanel', 
        role: 'dialog', 
        'aria-modal': 'true', 
        'aria-labelledby': 'feedbackTitle',
        style: {
          background: '#1a1a1a',
          color: '#f1f1f1',
          border: '1px solid #333',
          borderRadius: '12px',
          width: '480px',
          maxWidth: 'calc(100vw - 40px)',
          padding: '16px 18px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          position: 'relative'
        }
      }, [
        createElement('div', { 
          style: { 
            position: 'absolute', 
            top: '16px', 
            right: '16px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px', 
            fontSize: '.75em', 
            opacity: '.75' 
          } 
        }, [
          createElement('label', { for: 'fbShareLocation', style: { cursor: 'pointer' } }, ['Analytics']),
          createElement('input', { 
            id: 'fbShareLocation', 
            type: 'checkbox', 
            checked: 'checked', 
            title: 'Share approximate location (IP-based) for this message.', 
            style: { width: '14px', height: '14px' } 
          })
        ]),
        createElement('h3', { id: 'feedbackTitle', style: { margin: '0 0 10px 0' } }, ['Feedback & Bugs']),
        createElement('div', { 
          className: 'settings-row', 
          style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } 
        }, [
          createElement('label', { for: 'fbSubject' }, ['Subject (10 words max)']),
          createElement('input', { 
            id: 'fbSubject', 
            type: 'text', 
            placeholder: 'Short subject', 
            style: { 
              padding: '.6em', 
              borderRadius: '8px', 
              border: '1px solid #444', 
              background: '#2a2a2a', 
              color: '#f1f1f1' 
            } 
          })
        ]),
        createElement('div', { 
          className: 'settings-row', 
          style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px', marginTop: '8px' } 
        }, [
          createElement('label', { for: 'fbMessage' }, ['Message (240 characters max)']),
          createElement('textarea', { 
            id: 'fbMessage', 
            maxlength: '240', 
            rows: '5', 
            placeholder: 'Describe the issue or feedback', 
            style: { 
              padding: '.6em', 
              borderRadius: '8px', 
              border: '1px solid #444', 
              background: '#2a2a2a', 
              color: '#f1f1f1', 
              resize: 'vertical' 
            } 
          }),
          createElement('div', { 
            id: 'fbCount', 
            style: { fontSize: '.85em', opacity: '.8', textAlign: 'right' } 
          }, ['0 / 240'])
        ]),
        createElement('div', { 
          className: 'settings-actions', 
          style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' } 
        }, [
          createElement('button', { id: 'fbCancel', className: 'btn-ghost' }, ['Cancel']),
          createElement('button', { id: 'fbSend', className: 'btn-primary' }, ['Send'])
        ]),
        createElement('div', { 
          id: 'fbStatus', 
          style: { marginTop: '8px', fontSize: '.9em', minHeight: '1.2em', opacity: '.9' } 
        })
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create sources toolbar
  function createSourcesToolbar() {
    removeOverlay('sourcesToolbar');
    
    const toolbar = createElement('div', { 
      id: 'sourcesToolbar', 
      style: { 
        display: 'none', 
        gap: '8px', 
        alignItems: 'center', 
        padding: '8px 12px', 
        maxWidth: '1200px', 
        margin: '10px auto 0' 
      } 
    }, [
      createElement('label', { 
        for: 'sourcesSearchInput', 
        style: { fontWeight: '600', opacity: '.9' } 
      }, ['Search']),
      createElement('input', { 
        id: 'sourcesSearchInput', 
        type: 'search', 
        placeholder: 'Search sources...', 
        style: { 
          flex: '1', 
          padding: '.6em .8em', 
          borderRadius: '10px', 
          border: '1px solid #333', 
          background: '#141414', 
          color: '#f1f1f1' 
        } 
      })
    ]);
    
    // Insert before sourcesContainer
    const container = document.getElementById('sourcesContainer');
    if (container) {
      container.parentNode.insertBefore(toolbar, container);
    } else {
      document.body.appendChild(toolbar);
    }
    return toolbar;
  }

  // Create upload settings panel for Creator page
  function createUploadSettingsPanel() {
    removeOverlay('mmUploadSettingsPanel');
    
    const panel = createElement('div', { 
      id: 'mmUploadSettingsPanel', 
      className: 'mm-settings-panel', 
      role: 'dialog', 
      'aria-modal': 'true' 
    }, [
      createElement('div', { className: 'mm-card' }, [
        createElement('h3', { style: { margin: '.2em 0 0.6em 0' } }, ['Upload Settings']),
        createElement('div', { className: 'mm-settings-row', style: { alignItems: 'center', gap: '.6em' } }, [
          createElement('label', { style: { minWidth: '110px' } }, ['Library']),
          createElement('label', { className: 'mm-toggle', style: { gap: '.4em' } }, [
            createElement('input', { type: 'radio', name: 'mmLibraryMode', id: 'mmModeAnime', value: 'anime' }),
            createElement('span', {}, ['Anime'])
          ]),
          createElement('label', { className: 'mm-toggle', style: { gap: '.4em' } }, [
            createElement('input', { type: 'radio', name: 'mmLibraryMode', id: 'mmModeManga', value: 'manga' }),
            createElement('span', {}, ['Manga'])
          ])
        ]),
        createElement('div', { className: 'mm-settings-row' }, [
          createElement('label', { className: 'mm-toggle' }, [
            createElement('input', { type: 'checkbox', id: 'mmAnonToggle', checked: 'checked' }),
            createElement('span', {}, ['Anonymous uploads'])
          ])
        ]),
        createElement('div', { className: 'mm-settings-row' }, [
          createElement('label', { className: 'mm-toggle' }, [
            createElement('input', { type: 'checkbox', id: 'mmPosterCompressToggle', checked: 'checked' }),
            createElement('span', {}, ['Compress posters to WebP (512px height)'])
          ])
        ]),
        createElement('div', { className: 'mm-settings-row' }, [
          createElement('label', { className: 'mm-toggle' }, [
            createElement('input', { type: 'checkbox', id: 'mmSeparationToggle' }),
            createElement('span', {}, ['Separation tag (beta)'])
          ])
        ]),
        createElement('div', { 
          id: 'mmUserhashRow', 
          className: 'mm-settings-row', 
          style: { display: 'none', flexDirection: 'column', alignItems: 'stretch', marginLeft: '1.6em' } 
        }, [
          createElement('label', { for: 'mmUserhashInput' }, ['Userhash (used when Anonymous is off)']),
          createElement('input', { id: 'mmUserhashInput', className: 'mm-input', type: 'text', placeholder: 'Leave blank to use default' }),
          createElement('small', {}, ['Default if blank: ', createElement('code', {}, ['2cdcc7754c86c2871ed2bde9d'])])
        ]),
        createElement('div', { 
          id: 'mmCbzSection', 
          className: 'mm-settings-row', 
          style: { display: 'none', flexDirection: 'column', alignItems: 'flex-start', gap: '.4em', marginLeft: '0' } 
        }, [
          createElement('label', { className: 'mm-toggle', style: { gap: '.4em', alignItems: 'center' } }, [
            createElement('input', { type: 'checkbox', id: 'mmCbzExpandToggle' }),
            createElement('span', {}, ['CBZ Expansion'])
          ]),
          createElement('div', { id: 'mmCbzExpandSubrows', style: { display: 'none', marginLeft: '0.9em' } }, [
            createElement('label', { className: 'mm-toggle', style: { gap: '.4em', display: 'flex', alignItems: 'center', margin: '.2em 0' } }, [
              createElement('input', { type: 'checkbox', id: 'mmCbzExpandBatch' }),
              createElement('span', {}, ['Batch Uploads'])
            ]),
            createElement('label', { className: 'mm-toggle', style: { gap: '.4em', display: 'flex', alignItems: 'center', margin: '.2em 0' } }, [
              createElement('input', { type: 'checkbox', id: 'mmCbzExpandManual' }),
              createElement('span', {}, ['Singular/Manual File Uploads'])
            ])
          ])
        ]),
        createElement('div', { className: 'mm-settings-row', style: { alignItems: 'center', gap: '.6em' } }, [
          createElement('label', { for: 'mmUploadConcurrencyRange' }, ['Upload concurrency']),
          createElement('input', { 
            id: 'mmUploadConcurrencyRange', 
            type: 'range', 
            min: '1', 
            max: '8', 
            step: '1', 
            value: '2', 
            style: { flex: '1' } 
          }),
          createElement('span', { id: 'mmUploadConcurrencyValue', style: { minWidth: '2em', textAlign: 'right' } }, ['2'])
        ]),
        createElement('div', { className: 'mm-settings-row' }, [
          createElement('label', { className: 'mm-toggle', style: { gap: '.4em', alignItems: 'center' } }, [
            createElement('input', { type: 'checkbox', id: 'mmFolderUploadYellToggle', checked: 'checked' }),
            createElement('span', {}, ['Folder upload: yell when tab is hidden'])
          ])
        ]),
        createElement('div', { 
          className: 'mm-settings-row dev-menu-row', 
          id: 'devMenuRow', 
          style: { display: 'none', justifyContent: 'space-between', alignItems: 'center' }, 
          'data-setting-tag': 'dev' 
        }, [
          createElement('button', { id: 'devMenuBtn', type: 'button', className: 'dev-menu-trigger' }, ['Dev Menu']),
          createElement('span', { className: 'dev-menu-status', id: 'devMenuStatus' }, ['Developer tools'])
        ]),
        createElement('div', { className: 'mm-actions' }, [
          createElement('button', { id: 'mmSaveUploadSettings', className: 'mm-btn primary' }, ['Save']),
          createElement('button', { id: 'mmCloseUploadSettings', className: 'mm-btn ghost' }, ['Close'])
        ])
      ])
    ]);
    
    document.body.appendChild(panel);
    return panel;
  }

  // Create confirm modal for Creator page
  function createConfirmModal() {
    removeOverlay('confirmModal');
    
    const modal = createElement('div', { id: 'confirmModal' }, [
      createElement('div', { className: 'modal-content' }, [
        createElement('p', {}, ['Are you sure you want to delete this category?']),
        createElement('button', { id: 'confirmYes' }, ['Yes']),
        createElement('button', { id: 'confirmNo' }, ['Cancel'])
      ])
    ]);
    
    document.body.appendChild(modal);
    return modal;
  }

  // Create dev menu overlay
  function createDevMenuOverlay() {
    removeOverlay('devMenuOverlay');
    
    const overlay = createElement('div', { id: 'devMenuOverlay', 'aria-hidden': 'true' }, [
      createElement('div', { id: 'devMenuPanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'devMenuTitle' }, [
        createElement('div', { className: 'dev-menu-header' }, [
          createElement('h3', { id: 'devMenuTitle' }, ['Developer Menu']),
          createElement('button', { id: 'devMenuCloseBtn', type: 'button', 'aria-label': 'Close' }, ['✕'])
        ]),
        
        createElement('div', { className: 'dev-menu-content' }, [
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Download Concurrency']),
            createElement('div', { className: 'dev-field' }, [
              createElement('div', { className: 'dev-field-controls' }, [
                createElement('input', { type: 'number', id: 'devConcurrencyInput', min: '1', step: '1', value: '2' }),
                createElement('button', { id: 'devConcurrencyResetBtn', type: 'button' }, ['Reset to Default'])
              ]),
              createElement('p', { className: 'dev-menu-hint' }, ['Number of simultaneous downloads. Higher values may be faster but use more resources.'])
            ])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Catbox Settings']),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devCatboxUploadUrl' }, ['Upload URL']),
              createElement('input', { 
                type: 'text', 
                id: 'devCatboxUploadUrl', 
                className: 'dev-field-input',
                placeholder: 'Catbox upload endpoint for proxy' 
              }),
              createElement('p', { className: 'dev-menu-hint' }, ['Set only when Mode is Proxy.'])
            ]),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devCatboxMode' }, ['Mode']),
              createElement('select', { id: 'devCatboxMode', className: 'dev-field-input' }, [
                createElement('option', { value: 'default' }, ['Default']),
                createElement('option', { value: 'proxy' }, ['Proxy'])
              ]),
              createElement('p', { className: 'dev-menu-hint select' }, ['Choose Default (worker) or Proxy (custom URL).'])
            ])
          ]),

	          createElement('div', { className: 'dev-menu-section' }, [
	            createElement('h4', {}, ['Clip Backend']),
	            createElement('div', { className: 'dev-field' }, [
	              createElement('label', { for: 'devClipBackendUrl' }, ['Clip backend URL']),
	              createElement('input', {
	                type: 'text',
	                id: 'devClipBackendUrl',
	                className: 'dev-field-input',
	                placeholder: 'https://mm.littlehacker303.workers.dev/clip'
	              }),
	              createElement('p', { className: 'dev-menu-hint' }, ['Override the clip/set segment endpoint.'])
	            ])
	          ]),

	          createElement('div', { className: 'dev-menu-section' }, [
	            createElement('h4', {}, ['Playback']),
	            createElement('div', { className: 'dev-field' }, [
	              createElement('label', { for: 'devPartPreloadMethod' }, ['Part preload method']),
	              createElement('select', { id: 'devPartPreloadMethod', className: 'dev-field-input' }, [
	                createElement('option', { value: 'fetch' }, ['Fetch']),
	                createElement('option', { value: 'video' }, ['Video (fallback)'])
	              ]),
	              createElement('p', { className: 'dev-menu-hint select' }, ['Force how separated-part prefetch warms the next part.'])
	            ])
	          ]),
 	          
	          createElement('div', { className: 'dev-menu-section' }, [
	            createElement('h4', {}, ['Quick Actions']),
	            createElement('div', { id: 'devActionGrid', className: 'dev-action-grid' }, [
	              createElement('button', { type: 'button', 'data-dev-action': 'notice:info' }, ['Test Info Notice']),
              createElement('button', { type: 'button', 'data-dev-action': 'notice:error' }, ['Test Error Notice']),
              createElement('button', { type: 'button', 'data-dev-action': 'storage:menu' }, ['Storage Menu']),
              createElement('button', { type: 'button', 'data-dev-action': 'catbox:detect' }, ['Detect Catbox']),
              createElement('button', { type: 'button', 'data-dev-action': 'clip:preset' }, ['Clip Preset']),
              createElement('button', { type: 'button', 'data-dev-action': 'sources:reload' }, ['Reload Sources'])
            ])
          ]),
          
          
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('div', { className: 'dev-diagnostics-header' }, [
              createElement('h4', {}, ['Diagnostics']),
              createElement('button', { id: 'devDiagnosticsRefreshBtn', type: 'button' }, ['Refresh'])
            ]),
            createElement('dl', { className: 'dev-stats' }, [
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Dev Mode']),
                createElement('dd', { id: 'devModeStateLabel' }, ['Off'])
              ]),
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Concurrency']),
                createElement('dd', { id: 'devConcurrencyStateLabel' }, ['2'])
              ]),
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Catbox Endpoint']),
              createElement('dd', { id: 'devCatboxEndpointLabel' }, ['Pending'])
            ]),
            createElement('div', { className: 'dev-stat' }, [
              createElement('dt', {}, ['Clip Backend']),
              createElement('dd', { id: 'devClipEndpointLabel' }, ['Pending'])
            ]),
            createElement('div', { className: 'dev-stat' }, [
              createElement('dt', {}, ['Source Key']),
              createElement('dd', { id: 'devSourceKeyLabel' }, ['Not set'])
            ])
          ])
        ])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create Creator-specific dev menu overlay
  function createCreatorDevMenuOverlay() {
    removeOverlay('devMenuOverlay');
    
    const overlay = createElement('div', { id: 'devMenuOverlay', 'aria-hidden': 'true' }, [
      createElement('div', { id: 'devMenuPanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'devMenuTitle' }, [
        createElement('div', { className: 'dev-menu-header' }, [
          createElement('h3', { id: 'devMenuTitle' }, ['Creator Developer Menu']),
          createElement('button', { id: 'devMenuCloseBtn', type: 'button', 'aria-label': 'Close' }, ['✕'])
        ]),
        
        createElement('div', { className: 'dev-menu-content' }, [
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Upload Concurrency']),
            createElement('div', { className: 'dev-field' }, [
              createElement('div', { className: 'dev-field-controls' }, [
                createElement('input', { type: 'number', id: 'devUploadConcurrencyInput', min: '1', step: '1', value: '2' }),
                createElement('button', { id: 'devUploadConcurrencyResetBtn', type: 'button' }, ['Reset to Default'])
              ]),
              createElement('p', { className: 'dev-menu-hint' }, ['Number of simultaneous uploads. Higher values may be faster but use more resources.'])
            ])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Hidden Source Control']),
            createElement('label', { className: 'dev-menu-toggle' }, [
              createElement('input', { type: 'checkbox', id: 'devHiddenSourceToggle' }),
              createElement('span', {}, ['Enable Hidden Source Naming'])
            ]),
            createElement('p', { className: 'dev-menu-hint' }, ['Allows naming sources with underscores for hidden/private sources.'])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['GitHub Settings']),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devGithubWorkerUrl' }, ['Worker URL']),
              createElement('input', { 
                type: 'text', 
                id: 'devGithubWorkerUrl', 
                className: 'dev-field-input',
                placeholder: 'GitHub Worker endpoint URL' 
              }),
              createElement('p', { className: 'dev-menu-hint' }, ['URL for the GitHub worker service.'])
            ]),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devGithubToken' }, ['GitHub Token']),
              createElement('input', { 
                type: 'password', 
                id: 'devGithubToken', 
                className: 'dev-field-input',
                placeholder: 'Optional GitHub token' 
              }),
              createElement('p', { className: 'dev-menu-hint' }, ['Personal access token for GitHub operations.'])
            ]),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devWebhookUrl' }, ['Discord Webhook Override']),
              createElement('input', {
                type: 'text',
                id: 'devWebhookUrl',
                className: 'dev-field-input',
                placeholder: 'Leave blank to use default webhook'
              }),
              createElement('p', { className: 'dev-menu-hint' }, ['Optional Discord webhook for upload summaries.'])
            ])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Catbox Settings']),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devCatboxUploadUrl' }, ['Upload URL']),
              createElement('input', { 
                type: 'text', 
                id: 'devCatboxUploadUrl', 
                className: 'dev-field-input',
                placeholder: 'Catbox upload endpoint for proxy' 
              }),
              createElement('p', { className: 'dev-menu-hint' }, ['Set only when Mode is Proxy.'])
            ]),
            createElement('div', { className: 'dev-field' }, [
              createElement('label', { for: 'devCatboxMode' }, ['Mode']),
              createElement('select', { id: 'devCatboxMode', className: 'dev-field-input' }, [
                createElement('option', { value: 'default' }, ['Default']),
                createElement('option', { value: 'proxy' }, ['Proxy'])
              ]),
              createElement('p', { className: 'dev-menu-hint select' }, ['Choose Default (worker) or Proxy (custom URL).'])
            ])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('h4', {}, ['Quick Actions']),
            createElement('div', { id: 'devActionGrid', className: 'dev-action-grid' }, [
              createElement('button', { type: 'button', 'data-dev-action': 'notice:info' }, ['Test Info Notice']),
              createElement('button', { type: 'button', 'data-dev-action': 'notice:error' }, ['Test Error Notice']),
              createElement('button', { type: 'button', 'data-dev-action': 'catbox:detect' }, ['Detect Catbox']),
              createElement('button', { type: 'button', 'data-dev-action': 'creator:open-settings' }, ['Upload Settings']),
              createElement('button', { type: 'button', 'data-dev-action': 'creator:test-json' }, ['Test JSON Upload'])
            ])
          ]),
          
          createElement('div', { className: 'dev-menu-section' }, [
            createElement('div', { className: 'dev-menu-diagnostics-header' }, [
              createElement('h4', {}, ['Diagnostics']),
              createElement('button', { id: 'devDiagnosticsRefreshBtn', type: 'button' }, ['Refresh'])
            ]),
            createElement('dl', { className: 'dev-stats' }, [
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Dev Mode']),
                createElement('dd', { id: 'devModeStateLabel' }, ['Off'])
              ]),
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Upload Concurrency']),
                createElement('dd', { id: 'devUploadConcurrencyStateLabel' }, ['2'])
              ]),
              createElement('div', { className: 'dev-stat' }, [
                createElement('dt', {}, ['Catbox Endpoint']),
                createElement('dd', { id: 'devCatboxEndpointLabel' }, ['Pending'])
              ])
            ])
          ])
        ])
      ])
    ]);
    
    document.body.appendChild(overlay);
    return overlay;
  }

  // Public API
  return {
    createSettingsOverlay,
    createClearStorageOverlay,
    createStorageImportOverlay,
    createStorageImportScanOverlay,
    createClipPresetOverlay,
    createClipOverlay,
    createClipProgressOverlay,
    createCbzProgressOverlay,
    createSourcesSettingsOverlay,
    createFeedbackOverlay,
    createSourcesToolbar,
    createUploadSettingsPanel,
    createConfirmModal,
    createDevMenuOverlay,
    createCreatorDevMenuOverlay,
    removeOverlay
  };
})();
