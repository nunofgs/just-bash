/**
 * Form data handling for curl command
 */
import { toBuffer } from "../../fs/encoding.js";
function isUnreservedByte(byte) {
    return ((byte >= 0x30 && byte <= 0x39) || // 0-9
        (byte >= 0x41 && byte <= 0x5a) || // A-Z
        (byte >= 0x61 && byte <= 0x7a) || // a-z
        byte === 0x2d || // -
        byte === 0x2e || // .
        byte === 0x5f || // _
        byte === 0x7e // ~
    );
}
/**
 * URL-encode form data in curl's --data-urlencode format
 * Supports: name=content, =content, name@file, @file
 */
export function encodeFormData(input) {
    const encodeBinaryString = (value) => {
        let encoded = "";
        for (const byte of toBuffer(value, "binary")) {
            if (isUnreservedByte(byte)) {
                encoded += String.fromCharCode(byte);
            }
            else {
                encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
            }
        }
        return encoded;
    };
    // Check for name=value format
    const eqIndex = input.indexOf("=");
    if (eqIndex >= 0) {
        const name = input.slice(0, eqIndex);
        const value = input.slice(eqIndex + 1);
        if (name) {
            return `${encodeBinaryString(name)}=${encodeBinaryString(value)}`;
        }
        return encodeBinaryString(value);
    }
    // Plain value
    return encodeBinaryString(input);
}
/**
 * Parse -F/--form field specification
 * Supports: name=value, name=@file, name=<file, name=value;type=mime
 */
export function parseFormField(spec) {
    const eqIndex = spec.indexOf("=");
    if (eqIndex < 0)
        return null;
    const name = spec.slice(0, eqIndex);
    let value = spec.slice(eqIndex + 1);
    let filename;
    let contentType;
    // Check for ;type= suffix
    const typeMatch = value.match(/;type=([^;]+)$/);
    if (typeMatch) {
        contentType = typeMatch[1];
        value = value.slice(0, -typeMatch[0].length);
    }
    // Check for ;filename= suffix
    const filenameMatch = value.match(/;filename=([^;]+)/);
    if (filenameMatch) {
        filename = filenameMatch[1];
        value = value.replace(filenameMatch[0], "");
    }
    // @ means file upload, < means file content
    if (value.startsWith("@") || value.startsWith("<")) {
        filename = filename ?? value.slice(1).split("/").pop();
        // Value will be replaced with file content in execute
    }
    return { name, value, filename, contentType };
}
/**
 * Generate multipart form data body and boundary
 */
export function generateMultipartBody(fields, fileContents) {
    const boundary = `----CurlFormBoundary${Date.now().toString(36)}`;
    const parts = [];
    for (const field of fields) {
        const value = field.value;
        // Replace file references with content
        if (value.startsWith("@") || value.startsWith("<")) {
            const filePath = value.slice(1);
            const fileContent = fileContents.get(filePath) ?? new Uint8Array();
            let headers = `--${boundary}\r\n`;
            headers += `Content-Disposition: form-data; name="${field.name}"; filename="${field.filename}"\r\n`;
            if (field.contentType) {
                headers += `Content-Type: ${field.contentType}\r\n`;
            }
            headers += "\r\n";
            parts.push(toBuffer(headers, "binary"), fileContent, toBuffer("\r\n", "binary"));
            continue;
        }
        let part = `--${boundary}\r\n`;
        part += `Content-Disposition: form-data; name="${field.name}"\r\n`;
        part += `\r\n${value}\r\n`;
        parts.push(toBuffer(part, "binary"));
    }
    parts.push(toBuffer(`--${boundary}--\r\n`, "binary"));
    const totalLength = parts.reduce((sum, chunk) => sum + chunk.length, 0);
    const body = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of parts) {
        body.set(chunk, offset);
        offset += chunk.length;
    }
    return { body, boundary };
}
