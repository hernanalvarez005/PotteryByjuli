import { describe, it, expect } from "vitest";
import {
  isPrivateOrReservedIp,
  validateImageUrlShape,
  isAllowedImageContentType,
  extensionForContentType,
} from "./image-url-import";

describe("isPrivateOrReservedIp", () => {
  it("flags loopback", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
  });

  it("flags the cloud metadata / link-local range", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
  });

  it("flags the private ranges", () => {
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
  });

  it("never flags a normal public address", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("151.101.1.140")).toBe(false); // a real Fastly edge IP
  });
});

describe("validateImageUrlShape", () => {
  it("accepts a normal https URL", () => {
    const result = validateImageUrlShape("https://cdn.example.com/photo.jpg");
    expect(result.ok).toBe(true);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(validateImageUrlShape("file:///etc/passwd").ok).toBe(false);
    expect(validateImageUrlShape("ftp://example.com/x.jpg").ok).toBe(false);
  });

  it("rejects localhost and an IP literal in the private/loopback range", () => {
    expect(validateImageUrlShape("http://localhost/x.jpg").ok).toBe(false);
    expect(validateImageUrlShape("http://127.0.0.1/x.jpg").ok).toBe(false);
    expect(validateImageUrlShape("http://169.254.169.254/latest/meta-data/").ok).toBe(false);
  });

  it("rejects a garbage string that isn't a URL at all", () => {
    expect(validateImageUrlShape("not a url").ok).toBe(false);
  });
});

describe("isAllowedImageContentType", () => {
  it("accepts the three supported image types", () => {
    expect(isAllowedImageContentType("image/jpeg")).toBe(true);
    expect(isAllowedImageContentType("image/png")).toBe(true);
    expect(isAllowedImageContentType("image/webp")).toBe(true);
  });

  it("accepts a content-type with a charset suffix", () => {
    expect(isAllowedImageContentType("image/jpeg; charset=binary")).toBe(true);
  });

  it("rejects a non-image content type — this is the point of validating it server-side", () => {
    expect(isAllowedImageContentType("text/html")).toBe(false);
    expect(isAllowedImageContentType("application/octet-stream")).toBe(false);
  });

  it("rejects a missing content-type rather than assuming it's an image", () => {
    expect(isAllowedImageContentType(null)).toBe(false);
  });
});

describe("extensionForContentType", () => {
  it("maps each supported type to a sane extension", () => {
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/webp")).toBe("webp");
    expect(extensionForContentType("image/jpeg")).toBe("jpg");
  });
});
