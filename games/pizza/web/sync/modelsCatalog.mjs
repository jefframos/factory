// modelsCatalog.mjs
//
// Read-only catalog of every model in games/pizza/registry/assetsRegistry/
// modelsRegistry.ts — an AUTO-GENERATED file (see its own "DO NOT EDIT"
// header; produced by tools/models/build-models.mjs from raw-assets/models)
// that exports a `MODELS` object grouped by top-level models folder (e.g.
// `MODELS.Props.Tree`, `MODELS.Tools.Axe`). This module parses it with
// ts-morph (read-only, never written to — regenerating it is the build
// tool's job, not this editor's) so the editor's model picker can offer a
// grouped ("node") dropdown instead of a 500+ entry flat list, and so a
// picked model can be validated against what's actually registered.
//
// A model REFERENCE in source code (e.g. `AssetLibraryEntry.models:
// [MODELS.Props.Tree]`) is a property-access EXPRESSION, not a string — the
// editor's own JSON mirrors store it as the bare "Group.Key" dot-path
// (e.g. "Props.Tree") instead, and syncToSource.mjs's serializer turns that
// back into `MODELS.Group.Key` text on save (see its own doc for why this
// needs the same enum-reference-style treatment `item: ItemType.Axe` does).

import { Project, SyntaxKind } from 'ts-morph';

const project = new Project({ skipAddingFilesFromTsConfig: true });

/** Unwraps `expr as const` / `expr satisfies T` down to the plain expression it wraps — ts-morph sees both as a distinct node kind around the real initializer. */
function unwrapTypeExpression(expr) {
    const asExpr = expr.asKind(SyntaxKind.AsExpression);
    if (asExpr) return unwrapTypeExpression(asExpr.getExpression());
    const satisfiesExpr = expr.asKind(SyntaxKind.SatisfiesExpression);
    if (satisfiesExpr) return unwrapTypeExpression(satisfiesExpr.getExpression());
    return expr;
}

function getStringPropertyValue(objLiteral, name) {
    const prop = objLiteral.getProperty(name)?.asKind(SyntaxKind.PropertyAssignment);
    const initializer = prop?.getInitializer();
    return initializer?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
}

/**
 * Parses `modelsRegistryFilePath` into `{ groups: [{ name, items: [{ key, id, path,
 * fullPath, format }] }] }`. Returns `{ groups: [], error }` if the file can't be
 * read/parsed — a stale/missing registry shouldn't crash the editor, just leave the model
 * picker showing nothing (with the error visible) until the registry is regenerated.
 */
export function readModelsCatalog(modelsRegistryFilePath) {
    let sourceFile;
    try {
        sourceFile = project.getSourceFile(modelsRegistryFilePath) ?? project.addSourceFileAtPath(modelsRegistryFilePath);
        sourceFile.refreshFromFileSystemSync();
    } catch (err) {
        return { groups: [], error: `couldn't read models registry: ${err.message}` };
    }

    const modelsDecl = sourceFile.getVariableDeclaration('MODELS');
    if (!modelsDecl) {
        return { groups: [], error: 'no "MODELS" export found in the models registry' };
    }

    const modelsLiteral = unwrapTypeExpression(modelsDecl.getInitializerOrThrow())
        .asKind(SyntaxKind.ObjectLiteralExpression);
    if (!modelsLiteral) {
        return { groups: [], error: '"MODELS" export isn\'t an object literal' };
    }

    const groups = [];
    for (const groupProp of modelsLiteral.getProperties()) {
        const groupAssignment = groupProp.asKind(SyntaxKind.PropertyAssignment);
        const groupLiteral = groupAssignment?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
        if (!groupAssignment || !groupLiteral) continue;

        const items = [];
        for (const itemProp of groupLiteral.getProperties()) {
            const itemAssignment = itemProp.asKind(SyntaxKind.PropertyAssignment);
            const identifier = itemAssignment?.getInitializer()?.asKind(SyntaxKind.Identifier);
            if (!itemAssignment || !identifier) continue;

            // Each group entry (e.g. `Tree: PropsTree`) points at a top-level const —
            // resolve it to read that model's own id/path/format/fullPath.
            const targetDecl = sourceFile.getVariableDeclaration(identifier.getText());
            const targetLiteral = targetDecl && unwrapTypeExpression(targetDecl.getInitializerOrThrow())
                .asKind(SyntaxKind.ObjectLiteralExpression);
            if (!targetLiteral) continue;

            items.push({
                key: itemAssignment.getName().replace(/^['"]|['"]$/g, ''),
                id: getStringPropertyValue(targetLiteral, 'id') ?? '',
                path: getStringPropertyValue(targetLiteral, 'path') ?? '',
                fullPath: getStringPropertyValue(targetLiteral, 'fullPath') ?? '',
                format: getStringPropertyValue(targetLiteral, 'format') ?? '',
            });
        }

        groups.push({ name: groupAssignment.getName().replace(/^['"]|['"]$/g, ''), items });
    }

    return { groups, error: null };
}
