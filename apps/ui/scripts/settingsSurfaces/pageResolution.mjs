/**
 * Resolves a settings route to the component that renders its page (shared by the codemods).
 */
import { readFileSync } from 'node:fs';

import { absOf, importBindings, isFunctionLike, isJsx, parseSource, resolveModule, tagNameOf, ts, unwrap } from './lib.mjs';

/** Finds the declaration of component `name` in a file: `{ fn, sf, text }` or null. */
export function findComponent(rel, name) {
    const text = readFileSync(absOf(rel), 'utf8');
    const sf = parseSource(rel, text);
    let fn = null;
    const fromInitializer = (init) => {
        let current = unwrap(init);
        // React.memo(…), memo(…), React.forwardRef(…) wrappers
        while (current && ts.isCallExpression(current) && current.arguments.length >= 1) {
            current = unwrap(current.arguments[0]);
        }
        if (current && (ts.isArrowFunction(current) || ts.isFunctionExpression(current))) return current;
        return null;
    };
    for (const statement of sf.statements) {
        if (name === 'default') {
            if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) fn = statement;
            if (ts.isExportAssignment(statement)) {
                const expr = unwrap(statement.expression);
                if (ts.isIdentifier(expr)) return resolveIdentifier(rel, sf, text, expr.text);
                fn = fromInitializer(expr);
            }
            continue;
        }
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) fn = statement;
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (declaration.name.getText(sf) === name && declaration.initializer) fn = fromInitializer(declaration.initializer);
            }
        }
    }
    if (!fn && name !== 'default') {
        // `export { X } from './y'` or re-export of an import
        const binding = importBindings(sf).get(name);
        if (binding) {
            const target = resolveModule(rel, binding.module);
            if (target) return findComponent(target, binding.kind === 'default' ? 'default' : binding.imported);
        }
        for (const statement of sf.statements) {
            if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                for (const element of statement.exportClause.elements) {
                    if (element.name.text === name) {
                        const target = resolveModule(rel, statement.moduleSpecifier.text);
                        if (target) return findComponent(target, (element.propertyName ?? element.name).text);
                    }
                }
            }
        }
    }
    if (!fn && name === 'default') {
        for (const statement of sf.statements) {
            if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
                for (const element of statement.exportClause.elements) {
                    if (element.name.text === 'default') {
                        const local = (element.propertyName ?? element.name).text;
                        if (statement.moduleSpecifier) {
                            const target = resolveModule(rel, statement.moduleSpecifier.text);
                            if (target) return findComponent(target, local);
                        }
                        return resolveIdentifier(rel, sf, text, local);
                    }
                }
            }
        }
    }
    return fn ? { rel, fn, sf, text } : null;
}

export function resolveIdentifier(rel, sf, text, name) {
    const binding = importBindings(sf).get(name);
    if (binding) {
        const target = resolveModule(rel, binding.module);
        if (!target) return { outside: binding.module };
        return findComponent(target, binding.kind === 'default' ? 'default' : binding.imported);
    }
    return findComponent(rel, name);
}

/** Return statements of `fn` itself (not of nested functions), unwrapped. */
export function rootReturns(fn) {
    const out = [];
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
        out.push(unwrap(fn.body));
        return out;
    }
    const visit = (node) => {
        if (node !== fn && isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) out.push(unwrap(node.expression));
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
    return out;
}


/** Resolves the page component of a route to `{ component, returns }` following wrapper elements. */
export function resolvePage(componentRef, depth = 0) {
    if (!componentRef || componentRef.outside) return { error: 'component outside sources', detail: componentRef?.outside };
    const returns = rootReturns(componentRef.fn).filter((expr) => expr && expr.kind !== ts.SyntaxKind.NullKeyword);
    const itemLists = returns.filter((expr) => isJsx(expr) && tagNameOf(expr) === 'ItemList');
    if (itemLists.length > 0) return { component: componentRef, itemLists, otherReturns: returns.filter((expr) => !itemLists.includes(expr)) };
    // A component that only renders another component: follow it.
    const jsxReturns = returns.filter((expr) => isJsx(expr));
    if (depth < 3 && jsxReturns.length >= 1) {
        const candidates = new Set(jsxReturns.map((expr) => tagNameOf(expr)).filter((tag) => /^[A-Z][A-Za-z0-9]*$/.test(tag)));
        const followable = [...candidates].filter((tag) => !['View', 'Fragment', 'React.Fragment'].includes(tag));
        if (followable.length === 1) {
            const next = resolveIdentifier(componentRef.rel, componentRef.sf, componentRef.text, followable[0]);
            if (next && !next.outside) return resolvePage(next, depth + 1);
        }
    }
    const tags = returns.map((expr) => (isJsx(expr) ? `<${tagNameOf(expr)}>` : ts.SyntaxKind[expr.kind]));
    return { error: 'page root is not an ItemList', detail: `${componentRef.rel}: ${[...new Set(tags)].join(', ') || 'no returns'}` };
}
