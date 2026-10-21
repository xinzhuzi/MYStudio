"""Select typed canvas versus reference latent from the assembly purpose."""
from __future__ import annotations


class MyQi21PurposeCanvas:
    CATEGORY = '漫影'
    RETURN_TYPES = ('BOOLEAN',)
    RETURN_NAMES = ('使用类型画幅',)
    FUNCTION = 'route'

    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'组装用途': (
            ['新建资产', '局部编辑', '画风转换', '无底座出图'],
            {'forceInput': True, 'tooltip': '连接提示词子图的组装用途；新建资产/无底座出图用类型画幅，其余保留参考图画幅'},
        )}}

    def route(self, 组装用途: str) -> tuple[bool]:
        if 组装用途 not in self.INPUT_TYPES()['required']['组装用途'][0]:
            raise ValueError(f'未知组装用途: {组装用途}')
        return (组装用途 in ('新建资产', '无底座出图'),)
