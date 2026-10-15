PIPELINE_VERSION = "animation-svg-v1"
PIPELINE_STEPS = [
    ("asset_import", "素材导入", False, 4),
    ("frame_extraction", "帧提取", False, 6),
    ("background_removal", "背景移除", True, 10),
    ("style_transfer", "风格迁移", True, 12),
    ("frame_composition", "帧合成", False, 6),
    ("video_encoding", "动画导出", False, 4),
]
