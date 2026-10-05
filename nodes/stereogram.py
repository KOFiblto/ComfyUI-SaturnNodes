import os
import urllib.request
import torch
import torch.nn.functional as F
import numpy as np

try:
    import folder_paths
except ImportError:
    folder_paths = None

# Global ONNX runtime session cache & predicted depth cache
_DEPTH_ORT_SESSION = None
_PREDICTED_DEPTH_CACHE = {}

def get_depth_model_path():
    """Returns local path to Depth Anything V2 Small ONNX model."""
    if folder_paths and hasattr(folder_paths, "models_dir") and folder_paths.models_dir:
        base_dir = os.path.join(folder_paths.models_dir, "depth")
    else:
        base_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
    os.makedirs(base_dir, exist_ok=True)
    return os.path.join(base_dir, "depth-anything-v2-small-518.onnx")

def ensure_depth_model():
    """Downloads Depth Anything V2 Small ONNX model if not already present."""
    target_path = get_depth_model_path()
    if os.path.exists(target_path) and os.path.getsize(target_path) > 10 * 1024 * 1024:
        return target_path

    temp_path = target_path + ".tmp"
    urls = [
        "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx",
        "https://nqrlabs.com/Stereonix/models/depth-anything-v2-small-518.onnx"
    ]

    print("[SaturnNodes 3D] Downloading Depth Anything V2 Small model (~94 MB)...")
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-SaturnNodes"})
            with urllib.request.urlopen(req, timeout=60) as resp, open(temp_path, "wb") as f:
                total_size = int(resp.headers.get("Content-Length", 0))
                downloaded = 0
                last_pct = 0
                while True:
                    chunk = resp.read(1024 * 1024 * 2)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size > 0:
                        pct = int((downloaded / total_size) * 100)
                        if pct >= last_pct + 25 or pct == 100:
                            print(f"[SaturnNodes 3D] Model download: {pct}% ({downloaded // (1024*1024)}MB / {total_size // (1024*1024)}MB)")
                            last_pct = pct

            if os.path.exists(temp_path) and os.path.getsize(temp_path) > 10 * 1024 * 1024:
                os.replace(temp_path, target_path)
                print(f"[SaturnNodes 3D] Successfully downloaded Depth Anything V2 to {target_path}")
                return target_path
        except Exception as e:
            print(f"[SaturnNodes 3D] Download error from {url}: {e}")
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    raise RuntimeError("Failed to download Depth Anything V2 Small ONNX model.")

def get_ort_session():
    """Retrieves or loads the ONNX runtime session for depth estimation."""
    global _DEPTH_ORT_SESSION
    if _DEPTH_ORT_SESSION is not None:
        return _DEPTH_ORT_SESSION

    try:
        import onnxruntime as ort
    except ImportError:
        raise RuntimeError("onnxruntime is required for built-in depth estimation. Install via: pip install onnxruntime")

    model_path = ensure_depth_model()
    available_providers = ort.get_available_providers()
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in available_providers else ["CPUExecutionProvider"]
    
    _DEPTH_ORT_SESSION = ort.InferenceSession(model_path, providers=providers)
    return _DEPTH_ORT_SESSION

def predict_depth_map(image_np):
    """
    Runs Depth Anything V2 Small on a single [H, W, 3] float32 image (0.0 to 1.0).
    Returns [H, W] normalized float32 depth map (0.0=far, 1.0=near).
    If onnxruntime or the model is unavailable, gracefully falls back to a pseudo-depth map.
    """
    H, W, _ = image_np.shape
    try:
        session = get_ort_session()
        if session is None:
            raise RuntimeError("ONNX runtime session could not be initialized.")

        target_size = 518
        scale = min(target_size / W, target_size / H)
        scaled_w = max(1, int(round(W * scale)))
        scaled_h = max(1, int(round(H * scale)))
        offset_x = (target_size - scaled_w) // 2
        offset_y = (target_size - scaled_h) // 2

        # Letterbox to 518x518 with black padding using PIL
        from PIL import Image
        uint_img = (image_np * 255.0).clip(0, 255).astype(np.uint8)
        scaled_pil = Image.fromarray(uint_img).resize((scaled_w, scaled_h), Image.Resampling.BILINEAR)
        scaled_img = np.array(scaled_pil, dtype=np.uint8)

        canvas = np.zeros((target_size, target_size, 3), dtype=np.uint8)
        canvas[offset_y:offset_y + scaled_h, offset_x:offset_x + scaled_w] = scaled_img

        # Normalize with ImageNet constants
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(1, 1, 3)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(1, 1, 3)
        norm = ((canvas.astype(np.float32) / 255.0) - mean) / std
        input_tensor = np.transpose(norm, (2, 0, 1))[np.newaxis, ...].astype(np.float32)

        # Run inference
        input_name = session.get_inputs()[0].name
        raw_depth = session.run(None, {input_name: input_tensor})[0][0] # [518, 518]

        # Crop out the letterbox padding and resize back to original (W, H)
        valid_depth = raw_depth[offset_y:offset_y + scaled_h, offset_x:offset_x + scaled_w]
        depth_pil = Image.fromarray(valid_depth.astype(np.float32), mode="F").resize((W, H), Image.Resampling.BILINEAR)
        depth_full = np.array(depth_pil, dtype=np.float32)

        # Normalize with p2 and p98 histogram percentiles
        p2 = np.percentile(depth_full, 2)
        p98 = np.percentile(depth_full, 98)
        denom = max(float(p98 - p2), 1e-6)
        depth_norm = np.clip((depth_full - p2) / denom, 0.0, 1.0).astype(np.float32)
        return depth_norm
    except Exception as e:
        print(f"[SaturnNodes 3D] Notice: Automatic depth model unavailable ({e}). Using pseudo-depth gradient fallback.")
        y_gradient = np.linspace(0.2, 1.0, H, dtype=np.float32).reshape(H, 1)
        luminance = np.dot(image_np[..., :3], [0.299, 0.587, 0.114])
        fallback = 0.7 * y_gradient + 0.3 * luminance
        denom = max(float(fallback.max() - fallback.min()), 1e-6)
        return ((fallback - fallback.min()) / denom).astype(np.float32)

def draw_alignment_dot(target_tensor, cx, cy, radius=5):
    """Draws a high-contrast white dot with black outline at (cx, cy) on [H, W, 3] tensor."""
    H, W, _ = target_tensor.shape
    y_min = max(0, cy - radius - 2)
    y_max = min(H, cy + radius + 3)
    x_min = max(0, cx - radius - 2)
    x_max = min(W, cx + radius + 3)

    if y_max <= y_min or x_max <= x_min:
        return

    yy, xx = torch.meshgrid(
        torch.arange(y_min, y_max, device=target_tensor.device),
        torch.arange(x_min, x_max, device=target_tensor.device),
        indexing="ij"
    )
    dist_sq = (xx - cx) ** 2 + (yy - cy) ** 2
    inner = dist_sq <= (radius ** 2)
    outer = (dist_sq <= ((radius + 1.5) ** 2)) & (~inner)

    target_tensor[yy[outer], xx[outer]] = 0.0
    target_tensor[yy[inner], xx[inner]] = 1.0


class SaturnStereo3D:
    """
    🪐 Stereoscopic 3D / Cross-Eye Generator
    Generates side-by-side 3D stereograms, parallel views, and red-cyan anaglyphs
    from 2D images using depth-based horizontal disparity mapping.
    Includes built-in Depth Anything V2 Small auto-inference, zoom & pan cropping,
    spacing/border padding, and alignment guide dots.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mode": ([
                    "Cross-Eye",
                    "Parallel (Wall-Eyed)",
                    "Red-Cyan Anaglyph",
                    "Side-by-Side (Parallel)",
                    "Top-Bottom (Over-Under)",
                    "Left Eye Only",
                    "Right Eye Only"
                ], {"default": "Cross-Eye"}),
                "depth_intensity": ("FLOAT", {
                    "default": 25.0, "min": 0.0, "max": 100.0, "step": 1.0,
                    "display": "slider",
                    "tooltip": "Controls how much the left and right perspectives shift apart."
                }),
                "depth_gamma": ("FLOAT", {
                    "default": 0.50, "min": 0.1, "max": 3.0, "step": 0.05,
                    "display": "slider",
                    "tooltip": "Adjust depth curve for realistic 3D falloff (Stereonix default is 0.50)."
                }),
                "invert_depth": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Flip which parts appear closer or further away."
                }),
                "convergence_plane": ("FLOAT", {
                    "default": 0.50, "min": 0.0, "max": 1.0, "step": 0.02,
                    "display": "slider",
                    "tooltip": "Depth level where parallax is zero (screen surface). Above pops out, below sinks in."
                }),
                "image_zoom": ("FLOAT", {
                    "default": 100.0, "min": 10.0, "max": 300.0, "step": 1.0,
                    "display": "slider",
                    "tooltip": "Zoom into areas of interest before generating 3D disparity."
                }),
                "pan_horizontal": ("FLOAT", {
                    "default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0,
                    "display": "slider",
                    "tooltip": "Horizontal pan offset (-100 to 100)."
                }),
                "pan_vertical": ("FLOAT", {
                    "default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0,
                    "display": "slider",
                    "tooltip": "Vertical pan offset (-100 to 100)."
                }),
                "gap_spacing": ("INT", {
                    "default": 20, "min": 0, "max": 1000, "step": 2,
                    "display": "number",
                    "tooltip": "Empty black space between the left and right images."
                }),
                "outer_border": ("INT", {
                    "default": 0, "min": 0, "max": 1000, "step": 2,
                    "display": "number",
                    "tooltip": "Black border padding around the canvas (allows shrinking images for easier cross-eye viewing)."
                }),
                "alignment_dots": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Place focus guide dots above each eye view to easily lock into 3D cross-eye view."
                }),
                "fill_method": ([
                    "Smooth (Bilinear Grid)",
                    "Nearest Neighbor (Stereonix)"
                ], {
                    "default": "Smooth (Bilinear Grid)",
                    "tooltip": "Hole-filling interpolation for occlusion gaps."
                }),
                "preview_zoom": ([
                    "Fit",
                    "25%",
                    "33%",
                    "50%",
                    "75%",
                    "100%"
                ], {
                    "default": "50%",
                    "tooltip": "Scale preview for easier cross-eye viewing on canvas (does not affect full output)."
                }),
            },
            "optional": {
                "depth_map": ("IMAGE", {
                    "tooltip": "Optional depth map. If disconnected, automatically runs Depth Anything V2."
                }),
            }
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE")
    RETURN_NAMES = ("stereogram", "left_eye", "right_eye", "depth_map")
    FUNCTION = "generate"
    CATEGORY = "🪐 SaturnNodes/3D & Previews"
    DESCRIPTION = (
        "Creates side-by-side cross-eye stereograms, parallel 3D views, and red-cyan anaglyphs "
        "from 2D images. Inspired by Stereonix, it includes automatic Depth Anything V2 Small fallback, "
        "custom depth gamma/inversion, zoom & pan cropping, adjustable gap/border spacing, and focus alignment dots."
    )

    def generate(
        self,
        image,
        mode="Cross-Eye",
        depth_intensity=25.0,
        depth_gamma=0.50,
        invert_depth=False,
        convergence_plane=0.50,
        image_zoom=100.0,
        pan_horizontal=0.0,
        pan_vertical=0.0,
        gap_spacing=20,
        outer_border=0,
        alignment_dots=True,
        fill_method="Smooth (Bilinear Grid)",
        preview_zoom="50%",
        depth_map=None,
        **kwargs
    ):
        device = image.device
        B, H, W, C = image.shape

        # 1. Obtain or generate depth map
        depth_tensors = []
        if depth_map is not None:
            # Handle incoming depth map tensor
            d_map = depth_map.to(device=device, dtype=torch.float32)
            if d_map.shape[1:3] != (H, W):
                d_perm = d_map.permute(0, 3, 1, 2) if d_map.dim() == 4 else d_map.unsqueeze(1)
                d_resized = F.interpolate(d_perm, size=(H, W), mode="bilinear", align_corners=False)
                d_map = d_resized.permute(0, 2, 3, 1) if d_map.dim() == 4 else d_resized.squeeze(1)

            if d_map.dim() == 4:
                d_tensor = d_map[..., 0] # take single channel
            else:
                d_tensor = d_map

            # Normalize 0 to 1
            for b in range(B):
                b_depth = d_tensor[b if b < d_tensor.shape[0] else 0]
                min_v = b_depth.min()
                max_v = b_depth.max()
                denom = max(float(max_v - min_v), 1e-6)
                depth_norm = torch.clamp((b_depth - min_v) / denom, 0.0, 1.0)
                depth_tensors.append(depth_norm)
        else:
            # Automatic Depth Estimation via Depth Anything V2 Small ONNX (cached for instant slider responsiveness)
            cpu_img = image.detach().cpu().numpy()
            for b in range(B):
                # Fast signature based on shape, sum, and corner samples
                img_slice = cpu_img[b]
                cache_key = (
                    img_slice.shape,
                    round(float(img_slice.sum()), 2),
                    round(float(img_slice[0, 0, 0]), 4),
                    round(float(img_slice[-1, -1, -1]), 4)
                )
                if cache_key in _PREDICTED_DEPTH_CACHE:
                    d_np = _PREDICTED_DEPTH_CACHE[cache_key]
                else:
                    d_np = predict_depth_map(img_slice)
                    if len(_PREDICTED_DEPTH_CACHE) > 16:
                        _PREDICTED_DEPTH_CACHE.clear()
                    _PREDICTED_DEPTH_CACHE[cache_key] = d_np
                depth_tensors.append(torch.from_numpy(d_np).to(device=device, dtype=torch.float32))

        depth_batch = torch.stack(depth_tensors, dim=0) # [B, H, W]

        # 2. Apply Invert & Depth Gamma
        if invert_depth:
            depth_batch = 1.0 - depth_batch

        if abs(depth_gamma - 1.0) > 1e-4:
            depth_batch = torch.pow(torch.clamp(depth_batch, 1e-6, 1.0), depth_gamma)

        # 3. Apply Zoom & Pan cropping if requested
        zoom_factor = max(0.1, float(image_zoom) / 100.0)
        pan_x_norm = float(pan_horizontal) / 100.0
        pan_y_norm = float(pan_vertical) / 100.0

        grid_y = torch.linspace(-1, 1, H, device=device).view(1, H, 1, 1).expand(B, H, W, 1)
        grid_x = torch.linspace(-1, 1, W, device=device).view(1, 1, W, 1).expand(B, H, W, 1)

        if abs(zoom_factor - 1.0) > 1e-4 or abs(pan_x_norm) > 1e-4 or abs(pan_y_norm) > 1e-4:
            crop_x = (grid_x - pan_x_norm) / zoom_factor
            crop_y = (grid_y - pan_y_norm) / zoom_factor
            crop_grid = torch.cat([crop_x, crop_y], dim=-1)

            img_perm = image.permute(0, 3, 1, 2)
            d_perm = depth_batch.unsqueeze(1)
            image_cropped = F.grid_sample(img_perm, crop_grid, mode="bilinear", padding_mode="zeros", align_corners=True).permute(0, 2, 3, 1)
            depth_cropped = F.grid_sample(d_perm, crop_grid, mode="bilinear", padding_mode="border", align_corners=True).squeeze(1)
        else:
            image_cropped = image
            depth_cropped = depth_batch

        # 4. Compute Parallax Shift (Horizontal Disparity)
        # Shift magnitude scales with image width: at intensity 100, maximum shift is 3.5% of width
        max_shift = (float(depth_intensity) / 100.0) * (W * 0.035)
        # Shift relative to convergence plane
        shift_px = (depth_cropped - float(convergence_plane)) * max_shift
        shift_norm = (shift_px * (2.0 / W)).unsqueeze(-1) # [B, H, W, 1]

        # 5. Generate Left and Right eye views
        grid_left = torch.cat([grid_x - shift_norm, grid_y], dim=-1)
        grid_right = torch.cat([grid_x + shift_norm, grid_y], dim=-1)

        img_in = image_cropped.permute(0, 3, 1, 2)

        if fill_method == "Nearest Neighbor (Stereonix)":
            # Backward warp with nearest-neighbor lookup matching classic Stereonix
            left_eye = F.grid_sample(img_in, grid_left, mode="nearest", padding_mode="border", align_corners=True).permute(0, 2, 3, 1)
            right_eye = F.grid_sample(img_in, grid_right, mode="nearest", padding_mode="border", align_corners=True).permute(0, 2, 3, 1)
        else:
            # Smooth bilinear grid sampling
            left_eye = F.grid_sample(img_in, grid_left, mode="bilinear", padding_mode="border", align_corners=True).permute(0, 2, 3, 1)
            right_eye = F.grid_sample(img_in, grid_right, mode="bilinear", padding_mode="border", align_corners=True).permute(0, 2, 3, 1)

        # 6. Composite according to Selected Mode
        if mode == "Left Eye Only":
            stereogram = left_eye
        elif mode == "Right Eye Only":
            stereogram = right_eye
        elif mode == "Red-Cyan Anaglyph":
            # Red channel from Left Eye, Cyan (Green + Blue) channels from Right Eye
            stereogram = torch.zeros_like(left_eye)
            stereogram[..., 0] = left_eye[..., 0]
            stereogram[..., 1] = right_eye[..., 1]
            stereogram[..., 2] = right_eye[..., 2]
        elif mode == "Top-Bottom (Over-Under)":
            gap_h = max(0, int(gap_spacing))
            border = max(0, int(outer_border))
            
            top_panel = left_eye
            bot_panel = right_eye
            
            if gap_h > 0:
                gap_row = torch.zeros((B, gap_h, W, C), device=device, dtype=torch.float32)
                stacked = torch.cat([top_panel, gap_row, bot_panel], dim=1)
            else:
                stacked = torch.cat([top_panel, bot_panel], dim=1)

            if border > 0:
                H_st, W_st = stacked.shape[1], stacked.shape[2]
                stereogram = torch.zeros((B, H_st + border * 2, W_st + border * 2, C), device=device, dtype=torch.float32)
                stereogram[:, border:border + H_st, border:border + W_st, :] = stacked
            else:
                stereogram = stacked
        else:
            # Side-by-Side: Cross-Eye vs Parallel
            # In Cross-Eye: Left panel is Right-Eye, Right panel is Left-Eye
            # In Parallel / Side-by-Side: Left panel is Left-Eye, Right panel is Right-Eye
            if mode == "Cross-Eye":
                panel_left = right_eye
                panel_right = left_eye
            else:
                panel_left = left_eye
                panel_right = right_eye

            gap_w = max(0, int(gap_spacing))
            border = max(0, int(outer_border))

            if gap_w > 0:
                gap_col = torch.zeros((B, H, gap_w, C), device=device, dtype=torch.float32)
                side_by_side = torch.cat([panel_left, gap_col, panel_right], dim=2)
            else:
                side_by_side = torch.cat([panel_left, panel_right], dim=2)

            # Apply outer border framing
            if border > 0:
                H_sbs, W_sbs = side_by_side.shape[1], side_by_side.shape[2]
                stereogram = torch.zeros((B, H_sbs + border * 2, W_sbs + border * 2, C), device=device, dtype=torch.float32)
                stereogram[:, border:border + H_sbs, border:border + W_sbs, :] = side_by_side
            else:
                stereogram = side_by_side

            # Add alignment guide dots
            if alignment_dots and (mode in ("Cross-Eye", "Parallel (Wall-Eyed)", "Side-by-Side (Parallel)")):
                # Center coordinates above left and right panels
                cx_left = border + (W // 2)
                cx_right = border + W + gap_w + (W // 2)
                cy_dot = border // 2 if border >= 18 else min(16, H // 12)

                dot_radius = max(4, min(8, W // 100))
                for b in range(B):
                    draw_alignment_dot(stereogram[b], cx_left, cy_dot, radius=dot_radius)
                    draw_alignment_dot(stereogram[b], cx_right, cy_dot, radius=dot_radius)

        # 7. Convert Depth to 3-channel image for output
        depth_output = depth_cropped.unsqueeze(-1).repeat(1, 1, 1, 3)

        return (stereogram, left_eye, right_eye, depth_output)

