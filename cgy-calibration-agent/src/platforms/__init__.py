"""平台适配器包。"""
from .platforms import PlatformAdapter, PlatformError, MockPlatformAdapter, CLIPlatformAdapter

__all__ = ["PlatformAdapter", "PlatformError", "MockPlatformAdapter", "CLIPlatformAdapter"]
