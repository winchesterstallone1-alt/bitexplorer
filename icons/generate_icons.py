import struct
import zlib
import math

def create_png(width, height, draw_func):
    # Generates a RGBA PNG using standard library zlib and struct
    raw_data = bytearray()
    for y in range(height):
        raw_data.append(0) # filter type 0 (None)
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw_data.extend([r, g, b, a])
    
    compressed = zlib.compress(raw_data, 9)
    
    def chunk(tag, data):
        c = tag + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
    
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', ihdr_data)
    png += chunk(b'IDAT', compressed)
    png += chunk(b'IEND', b'')
    return png

def draw_radar_icon(x, y, w, h):
    # Centered coords normalized -1 to 1
    cx = (x + 0.5 - w / 2) / (w / 2)
    cy = (y + 0.5 - h / 2) / (h / 2)
    dist = math.sqrt(cx * cx + cy * cy)
    angle = math.atan2(cy, cx) # -pi to pi

    # Background rounded squircle / circle
    if dist > 0.95:
        return (0, 0, 0, 0) # transparent
    
    # Outer dark badge
    if dist > 0.85:
        # Border
        return (247, 166, 0, 255) # Bybit gold border
    
    # Dark body
    bg_r, bg_g, bg_b = 20, 23, 31 # #14171F
    
    # Radar sweep line & concentric rings
    # Ring 1
    if 0.55 < dist < 0.62:
        return (247, 166, 0, 200)
    # Ring 2
    if 0.28 < dist < 0.35:
        return (0, 230, 118, 220)
    
    # Radar blip/dot at top right
    blip_dx = cx - 0.4
    blip_dy = cy - (-0.35)
    blip_dist = math.sqrt(blip_dx * blip_dx + blip_dy * blip_dy)
    if blip_dist < 0.18:
        return (0, 255, 128, 255) # bright green blip

    # Center dot
    if dist < 0.14:
        return (247, 166, 0, 255)

    # Radar sweep gradient
    norm_angle = (angle + math.pi) / (2 * math.pi)
    sweep_intensity = int(max(0, 1.0 - norm_angle * 3) * 60)
    
    r = min(255, bg_r + sweep_intensity)
    g = min(255, bg_g + sweep_intensity)
    b = min(255, bg_b + sweep_intensity)
    return (r, g, b, 255)

for size in [16, 48, 128]:
    png_data = create_png(size, size, draw_radar_icon)
    with open(f"icons/icon{size}.png", "wb") as f:
        f.write(png_data)

print("Icons generated successfully!")
