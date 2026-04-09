const BASE_URL = "/api";
export class ApiError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
export async function apiFetch(path, init) {
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
        ...init,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ApiError(response.status, text || response.statusText);
    }
    return (await response.json());
}
