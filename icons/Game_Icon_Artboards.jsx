#target photoshop
    /*
     Game Icon Artboards - Photoshop ExtendScript (.jsx)
     Run via File > Scripts > Browse.
     CREATE creates one editable PSD with nine independent artboards.
     EXPORT creates exact-size, platform-specific PNG/JPG files from those masters.
     MP4 trailer deliverables are omitted (use a video editor for footage).
    
     WARNING: Export rendering uses a flattened duplicate and crops to each source artboard.
     Keep reusable artwork INSIDE its artboard group, not as global top-level layers.
    */
    (function () {
        var S = stringIDToTypeID;
        var C = charIDToTypeID;
        var oldDialogs = app.displayDialogs;
        var oldUnits = app.preferences.rulerUnits;
        app.preferences.rulerUnits = Units.PIXELS;

        // Master compositions: exact aspect ratios; variants at same ratio are resized on export.
        var MASTERS = [
            { id: 'SQUARE', w: 800, h: 800 },
            { id: 'PORTRAIT_MC_5x7', w: 540, h: 756 },
            { id: 'PORTRAIT_2x3', w: 800, h: 1200 },
            { id: 'LANDSCAPE_16x9', w: 1920, h: 1080 },
            { id: 'LANDSCAPE_5x3', w: 1000, h: 600 },
            { id: 'LANDSCAPE_128x85', w: 1024, h: 680 },
            { id: 'LANDSCAPE_4x3', w: 1024, h: 768 },
            { id: 'BANNER_128x55', w: 1280, h: 550 },
            { id: 'COVER_8x5', w: 1360, h: 850 }
        ];

        // [platform, name, master, width, height, extension].
        // JPG used for destinations that permit JPG and PNG (change to png below if preferred).
        var OUTPUTS = [
            ['mc', 'portrait', 'PORTRAIT_MC_5x7', 540, 756, 'png'],
            ['mc', 'square', 'SQUARE', 512, 512, 'png'],
            ['poki', 'main_icon', 'SQUARE', 628, 628, 'png'],
            ['crazygames', 'square', 'SQUARE', 800, 800, 'png'],
            ['crazygames', 'portrait', 'PORTRAIT_2x3', 800, 1200, 'png'],
            ['crazygames', 'landscape', 'LANDSCAPE_16x9', 1920, 1080, 'png'],
            ['crazygames', 'icon', 'SQUARE', 512, 512, 'png'],
            ['crazygames', 'cover_banner', 'LANDSCAPE_16x9', 800, 450, 'jpg'],
            ['crazygames', 'featured_image', 'LANDSCAPE_16x9', 1200, 675, 'jpg'],
            ['crazygames', 'screenshot', 'LANDSCAPE_16x9', 1280, 720, 'png'],
            ['gamedistribution', 'small_icon', 'LANDSCAPE_5x3', 200, 120, 'jpg'],
            ['gamedistribution', 'medium_icon', 'LANDSCAPE_128x85', 512, 340, 'jpg'],
            ['gamedistribution', 'standard_icon', 'LANDSCAPE_4x3', 512, 384, 'jpg'],
            ['gamedistribution', 'high_res_icon', 'SQUARE', 512, 512, 'jpg'],
            ['gamedistribution', 'small_cover', 'BANNER_128x55', 1280, 550, 'jpg'],
            ['gamedistribution', 'large_cover', 'LANDSCAPE_16x9', 1280, 720, 'jpg'],
            ['gamepix', 'main_thumbnail', 'SQUARE', 256, 256, 'png'],
            ['gamepix', 'cover', 'COVER_8x5', 1360, 850, 'png'],
            ['gamepix', 'small_thumbnail', 'SQUARE', 100, 100, 'png']
        ];

        function getArtboardRect(layer) {
            var ref = new ActionReference();
            ref.putProperty(S('property'), S('artboard'));
            ref.putIdentifier(S('layer'), layer.id);
            var data = executeActionGet(ref).getObjectValue(S('artboard'));
            var rect = data.getObjectValue(S('artboardRect'));
            function val(k) { try { return rect.getDouble(S(k)); } catch (e) { return rect.getUnitDoubleValue(S(k)); } }
            return [val('left'), val('top'), val('right'), val('bottom')];
        }
        function isArtboard(layer) {
            if (layer.typename !== 'LayerSet') return false;
            try {
                var ref = new ActionReference();
                ref.putProperty(S('property'), S('artboardEnabled'));
                ref.putIdentifier(S('layer'), layer.id);
                return executeActionGet(ref).getBoolean(S('artboardEnabled'));
            } catch (e) { return false; }
        }
        function makeArtboard(name, x, y, w, h) {
            // Different Photoshop releases accept different artboardRect descriptor types.
            // Try the Photoshop-native float form first, then pixel-unit rectangle form.
            function attempt(useUnitRect, useUsing) {
                var d = new ActionDescriptor();
                var ref = new ActionReference();
                ref.putClass(S('artboardSection'));
                d.putReference(C('null'), ref);
                if (useUsing) {
                    var spec = new ActionDescriptor();
                    spec.putString(C('Nm  '), name);
                    d.putObject(C('Usng'), S('artboardSection'), spec);
                } else {
                    d.putString(S('name'), name);
                }
                var r = new ActionDescriptor();
                if (useUnitRect) {
                    r.putUnitDouble(C('Top '), C('#Pxl'), y);
                    r.putUnitDouble(C('Left'), C('#Pxl'), x);
                    r.putUnitDouble(C('Btom'), C('#Pxl'), y + h);
                    r.putUnitDouble(C('Rght'), C('#Pxl'), x + w);
                    d.putObject(S('artboardRect'), S('rectangle'), r);
                } else {
                    r.putDouble(S('top'), y);
                    r.putDouble(S('left'), x);
                    r.putDouble(S('bottom'), y + h);
                    r.putDouble(S('right'), x + w);
                    d.putObject(S('artboardRect'), S('classFloatRect'), r);
                }
                executeAction(S('make'), d, DialogModes.NO);
            }
            var errors = [];
            var variants = [[false, false], [false, true], [true, false], [true, true]];
            for (var k = 0; k < variants.length; k++) {
                try {
                    attempt(variants[k][0], variants[k][1]);
                    // When a make call succeeds, rename its new artboard via the DOM.
                    try { app.activeDocument.activeLayer.name = name; } catch (renameError) { }
                    return;
                } catch (e) {
                    errors.push('method ' + (k + 1) + ': ' + e.message);
                }
            }
            throw new Error('All artboard methods failed. ' + errors.join(' | '));
        }
        function create() {
            // Photoshop will extend the document when artboards are created outside this seed canvas.
            var d = app.documents.add(800, 800, 72, 'Game Icon Masters', NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
            // Keep Photoshop's initial layer: deleting the only layer can raise
            // 'The command Delete is not currently available' in some versions.
            d.activeLayer.name = 'STARTER - move artwork into artboards';
            var x = 0, y = 0, perRow = 3;
            for (var i = 0; i < MASTERS.length; i++) {
                var m = MASTERS[i];
                try {
                    makeArtboard(m.id, x, y, m.w, m.h);
                } catch (artboardError) {
                    throw new Error('Creating artboard ' + m.id + ': ' + artboardError.message);
                }
                if ((i + 1) % perRow === 0) { x = 0; y += 1350; }
                else { x += 2100; }
            }
            alert('Created ' + MASTERS.length + ' editable master artboards.\n\nSave as a PSD, then place artwork INSIDE each artboard group.\nRun this script again and choose Export.');
        }
        function folderFor(parent, child) { var f = new Folder(parent.fsName + '/' + child); if (!f.exists) f.create(); return f; }
        function findMaster(doc, name) {
            for (var i = 0; i < doc.layerSets.length; i++) {
                var l = doc.layerSets[i]; if (l.name === name && isArtboard(l)) return l;
            }
            return null;
        }
        function saveWeb(doc, dest, ext) {
            var opt = new ExportOptionsSaveForWeb();
            opt.format = (ext === 'png') ? SaveDocumentType.PNG : SaveDocumentType.JPEG;
            if (ext === 'png') { opt.PNG8 = false; opt.transparency = true; }
            else { opt.quality = 90; opt.optimized = true; }
            opt.includeProfile = false;
            doc.exportDocument(dest, ExportType.SAVEFORWEB, opt);
        }
        function exportAll() {
            if (!app.documents.length) { alert('Open the master PSD first.'); return; }
            var original = app.activeDocument;
            var outputRoot = Folder.selectDialog('Choose the folder for exported game icons');
            if (!outputRoot) return;
            var gameName = prompt('Game filename prefix (leave blank for none):', '');
            if (gameName === null) return;
            gameName = String(gameName).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
            var missing = [], count = 0;
            var boardIndex = {};
            for (var i = 0; i < MASTERS.length; i++) {
                var id = MASTERS[i].id, board = findMaster(original, id);
                if (!board) missing.push(id);
                else boardIndex[id] = getArtboardRect(board);
            }
            if (missing.length) { alert('Missing artboards:\n' + missing.join('\n') + '\n\nRun Create or restore those group names.'); return; }
            app.displayDialogs = DialogModes.NO;
            try {
                // Render each master once at native size, then make resized output copies.
                for (var mi = 0; mi < MASTERS.length; mi++) {
                    var master = MASTERS[mi], rect = boardIndex[master.id];
                    var tmp = original.duplicate('Temporary Export - ' + master.id, false);
                    try {
                        // Hide all other masters and any global/top-level layers.
                        for (var l = 0; l < tmp.layers.length; l++) {
                            tmp.layers[l].visible = (tmp.layers[l].name === master.id);
                        }
                        // IMPORTANT: Flatten BEFORE crop. While a document still contains
                        // artboards, Photoshop can interpret crop against the overall
                        // multi-artboard canvas or silently leave the canvas unchanged.
                        // Flatten removes all artboard metadata and leaves ordinary pixels.
                        try { tmp.flatten(); } catch (flattenError) {
                            throw new Error('Flattening ' + master.id + ': ' + flattenError.message);
                        }
                        tmp.crop([UnitValue(rect[0], 'px'), UnitValue(rect[1], 'px'), UnitValue(rect[2], 'px'), UnitValue(rect[3], 'px')]);
                        var actualW = Math.round(tmp.width.as('px'));
                        var actualH = Math.round(tmp.height.as('px'));
                        var expectedW = Math.round(rect[2] - rect[0]);
                        var expectedH = Math.round(rect[3] - rect[1]);
                        if (actualW !== expectedW || actualH !== expectedH) {
                            throw new Error('Crop failed for ' + master.id + ': expected ' + expectedW + 'x' + expectedH +
                                ', got ' + actualW + 'x' + actualH + '. Export cancelled instead of producing tiny artwork.');
                        }
                        for (var oi = 0; oi < OUTPUTS.length; oi++) {
                            var out = OUTPUTS[oi]; if (out[2] !== master.id) continue;
                            var resized = tmp.duplicate('Export ' + out[0] + ' ' + out[1], false);
                            try {
                                resized.resizeImage(UnitValue(out[3], 'px'), UnitValue(out[4], 'px'), null, ResampleMethod.BICUBICSHARPER);
                                var dir = folderFor(outputRoot, out[0]);
                                var fn = (gameName ? gameName + '_' : '') + out[1] + '.' + out[5];
                                saveWeb(resized, new File(dir.fsName + '/' + fn), out[5]);
                                count++;
                            } finally { resized.close(SaveOptions.DONOTSAVECHANGES); }
                        }
                    } finally { tmp.close(SaveOptions.DONOTSAVECHANGES); }
                }
                alert('Exported ' + count + ' images into platform subfolders.\n\nMP4 trailers are not generated.');
            } catch (e) {
                alert('Export stopped: ' + e.message + ' (line ' + e.line + ').\nThe original PSD was not modified.');
            }
        }
        try {
            var choice = prompt('Game Icon Artboards\n\nType CREATE for a new PSD\nor EXPORT to export the active PSD:', 'CREATE');
            if (choice === null) return;
            choice = String(choice).toUpperCase().replace(/^\s+|\s+$/g, '');
            if (choice === 'CREATE') create();
            else if (choice === 'EXPORT') exportAll();
            else alert('Please enter CREATE or EXPORT.');
        } catch (e) { alert('Script error: ' + e.message + ' (line ' + e.line + ').'); }
        finally { app.displayDialogs = oldDialogs; app.preferences.rulerUnits = oldUnits; }
    })();
