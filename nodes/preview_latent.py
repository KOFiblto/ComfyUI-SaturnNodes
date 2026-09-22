PREVIEW_CATEGORY = "🪐 SaturnNodes/Previews"

class PreviewLatentLiveNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {},
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    CATEGORY = PREVIEW_CATEGORY
    OUTPUT_NODE = True
    DESCRIPTION = "Renders real-time sampler latent previews directly inside this node canvas during generation."

    def run(self):
        return ()
