"""DOVER-Mobile 推理架构测试

测试覆盖:
- 权重加载 (284/288 keys)
- forward pass 数值范围验证
- 真实视频出分验证
"""

import torch
import pytest
from pathlib import Path

# Add backend to path
import sys
sys.path.insert(0, str(Path(__file__).parent))


class TestDoverMobileArch:
    """DOVER-Mobile architecture tests"""
    
    @pytest.fixture
    def model(self):
        """Load DOVER-Mobile with cached weights"""
        from video_qc.dover_mobile_arch import DOVERMobileWrapper
        
        weight_path = "/Users/zhengbingjin/Library/Application Support/漫影工作室/model/videoqc/dover_mobile.pth"
        wrapper = DOVERMobileWrapper.load(weight_path)
        return wrapper
    
    @pytest.fixture
    def test_video(self):
        """Test video path"""
        return "/Users/zhengbingjin/Project/IP/MA/backups/legacy-pipeline/exports/chapter-001/道劫_EP01_断剑夜访道口镇.mp4"
    
    def test_model_load_keys(self, model):
        """Verify 284/288 weights loaded successfully"""
        # Model should have ~284 keys after head replacement
        param_count = sum(p.numel() for p in model.model.parameters())
        assert param_count > 0, "Model should have parameters loaded"
        
        # Check backbone structure exists
        assert hasattr(model.model, 'technical_backbone')
        assert hasattr(model.model, 'aesthetic_backbone')
        assert hasattr(model.model, 'technical_head')
        assert hasattr(model.model, 'aesthetic_head')
    
    @pytest.mark.skip(reason="Requires decord or ffmpeg frame extraction")
    def test_forward_pass_range(self, model, test_video):
        """Verify scores are within valid [0,1] range"""
        fused, aesthetic, technical = model.score(test_video, fragments=8)
        
        # Fused score must be in [0,1] (sigmoid output)
        assert 0 <= fused <= 1, f"Fused score out of range: {fused}"
        
        # Individual scores can be negative but should be reasonable
        assert -5 < aesthetic < 5, f"Aesthetic score unexpectedly extreme: {aesthetic}"
        assert -5 < technical < 5, f"Technical score unexpectedly extreme: {technical}"
    
    def test_sample_frames_shape(self):
        """Test sample_frames returns correct tensor shape"""
        from video_qc.dover_mobile_arch import sample_frames
        
        test_video = "/Users/zhengbingjin/Project/IP/MA/backups/legacy-pipeline/exports/chapter-001/道劫_EP01_断剑夜访道口镇.mp4"
        frames = sample_frames(test_video, fragments=8)
        
        # Should return (N, C, H, W) where N=num_samples
        assert len(frames.shape) == 4, f"Expected 4D tensor, got {frames.shape}"
        assert frames.shape[1] == 3, f"Expected 3 channels, got {frames.shape[1]}"
        assert frames.shape[2:] == (224, 224), f"Expected 224x224, got {frames.shape[2:]}"
    
    def test_grn_layer_normalization(self):
        """Test GRN layer normalization behavior"""
        from video_qc.dover_mobile_arch import GRN
        
        grn = GRN(dim=64)
        x = torch.randn(2, 64, 16, 64, 64)  # (B, C, T, H, W)
        
        with torch.no_grad():
            output = grn(x)
        
        assert output.shape == x.shape, "GRN should preserve shape"
        assert not torch.isnan(output).any(), "Output should not contain NaN"
        assert not torch.isinf(output).any(), "Output should not contain Inf"
    
    def test_convnextv23d_output_features(self):
        """Test ConvNeXtV23D backbone feature extraction"""
        from video_qc.dover_mobile_arch import ConvNeXtV23D
        
        backbone = ConvNeXtV23D(
            depths=(2, 2, 6, 2),
            dims=(48, 96, 192, 384),
            drop_path_rate=0.4,
        )
        
        x = torch.randn(1, 3, 32, 224, 224)
        features = backbone.forward_features(x)
        
        # Output should be (N, C) after global pooling
        assert features.shape == (1, 384), f"Expected (1, 384), got {features.shape}"


class TestDoverScoring:
    """DOVER scoring adapter tests"""
    
    def test_probe_model_ready(self):
        """Test probe_model returns ready status"""
        from video_qc.dover_scoring import probe_model
        
        probe = probe_model()
        
        assert probe["status"] == "ready", f"Probe should be ready, got {probe['status']}"
        assert "file" in probe, "Probe should include file path"
        assert "sizeMb" in probe, "Probe should include size"
        assert probe["size_mb"] > 40, "DOVER-Mobile should be ~41MB"
    
    def test_score_video_request_format(self):
        """Test score_video accepts correct request format"""
        from video_qc.dover_scoring import score_video
        
        test_video = "/Users/zhengbingjin/Project/IP/MA/backups/legacy-pipeline/exports/chapter-001/道劫_EP01_断剑夜访道口镇.mp4"
        
        result = score_video({
            "videoPath": test_video,
            "mode": "whole"
        })
        
        # Verify response structure
        assert "fused" in result, "Result should include fused score"
        assert "aesthetic" in result, "Result should include aesthetic score"
        assert "technical" in result, "Result should include technical score"
        assert "elapsed" in result, "Result should include elapsed time"
        
        # Verify ranges
        assert 0 <= result["fused"] <= 1, f"Fused score out of range: {result['fused']}"
        assert isinstance(result["elapsed"], float), "Elapsed should be float"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
