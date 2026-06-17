function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function inferXKey(sampleRow) {
    const key = Object.keys(sampleRow).find((k) => {
        const v = sampleRow[k];
        return typeof v === "string";
    });
    return key;
}
function inferNumericKeys(sampleRow) {
    return Object.keys(sampleRow).filter((k) => isFiniteNumber(sampleRow[k]));
}
export function buildVisualizationPayload(rows, fallbackTitle) {
    const normalizedRows = rows.filter((r) => typeof r === "object" && r !== null);
    const sampleRow = normalizedRows[0] ?? {};
    const numericKeys = inferNumericKeys(sampleRow);
    const xKey = inferXKey(sampleRow);
    const hasYoy = Object.keys(sampleRow).some((k) => k.toUpperCase().includes("Y/Y"));
    const hasCyPy = Object.keys(sampleRow).some((k) => k.toUpperCase().startsWith("PY_"));
    if (normalizedRows.length <= 1 && numericKeys.length > 0 && hasYoy) {
        return {
            component: "kpi_with_yoy",
            title: fallbackTitle,
            yKeys: numericKeys,
            rowsPreview: normalizedRows.slice(0, 20)
        };
    }
    if (normalizedRows.length > 1 && xKey && hasYoy) {
        return {
            component: hasCyPy ? "grouped_bar_yoy" : "line_chart",
            title: fallbackTitle,
            xKey,
            yKeys: numericKeys,
            rowsPreview: normalizedRows.slice(0, 200)
        };
    }
    if (normalizedRows.length > 1 && xKey && numericKeys.length > 0) {
        return {
            component: "bar_chart",
            title: fallbackTitle,
            xKey,
            yKeys: numericKeys.slice(0, 3),
            rowsPreview: normalizedRows.slice(0, 200)
        };
    }
    return {
        component: "table",
        title: fallbackTitle,
        rowsPreview: normalizedRows.slice(0, 200)
    };
}
