// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import type { SceneEnvironmentType } from './scene-environment';

export interface ViewpointConfig {
  id: string;
  name: string;
  nameEn: string;
  propsZh: string[];
  propsEn: string[];
  /** 兼容的环境类型，空数组表示通用 */
  environments: SceneEnvironmentType[];
}

type DefaultViewpoint = {
  id: string;
  name: string;
  nameEn: string;
  keyProps: string[];
  keyPropsEn: string[];
  description: string;
  descriptionEn: string;
};

const commonDefaults: DefaultViewpoint[] = [
  { id: 'overview', name: '全景', nameEn: 'Overview', keyProps: [], keyPropsEn: [], description: '整体空间布局', descriptionEn: 'Overall spatial layout' },
  { id: 'detail', name: '细节', nameEn: 'Detail View', keyProps: [], keyPropsEn: [], description: '细节特写', descriptionEn: 'Detail close-up' },
];

/** 根据环境类型获取默认视角列表。 */
export function getDefaultViewpointsForEnvironment(
  envType: SceneEnvironmentType,
): DefaultViewpoint[] {
  switch (envType) {
    case 'vehicle':
      return [
        { id: 'vehicle_window', name: '车窗', nameEn: 'Vehicle Window View', keyProps: ['车窗', '窗外风景'], keyPropsEn: ['vehicle window', 'outside scenery'], description: '车窗视角', descriptionEn: 'Vehicle window view' },
        { id: 'vehicle_seat', name: '座位区', nameEn: 'Seat Area', keyProps: ['座位'], keyPropsEn: ['seat'], description: '座位区域', descriptionEn: 'Seating area' },
        { id: 'vehicle_aisle', name: '过道', nameEn: 'Aisle View', keyProps: ['过道', '扶手'], keyPropsEn: ['aisle', 'handrail'], description: '过道视角', descriptionEn: 'Aisle view' },
        { id: 'vehicle_driver', name: '驾驶位', nameEn: 'Driver Area', keyProps: ['方向盘'], keyPropsEn: ['steering wheel'], description: '驾驶区域', descriptionEn: 'Driver area' },
        ...commonDefaults,
      ];
    case 'outdoor':
      return [
        { id: 'nature', name: '自然风景', nameEn: 'Nature View', keyProps: [], keyPropsEn: [], description: '自然风景视角', descriptionEn: 'Nature scenery view' },
        { id: 'roadside', name: '路边', nameEn: 'Roadside View', keyProps: ['道路'], keyPropsEn: ['road'], description: '路边视角', descriptionEn: 'Roadside view' },
        { id: 'street', name: '街景', nameEn: 'Street View', keyProps: ['街道'], keyPropsEn: ['street'], description: '街景视角', descriptionEn: 'Street view' },
        ...commonDefaults,
      ];
    case 'indoor_home':
      return [
        { id: 'sofa', name: '沙发区', nameEn: 'Sofa Area', keyProps: ['沙发', '茶几'], keyPropsEn: ['sofa', 'coffee table'], description: '沙发区域', descriptionEn: 'Sofa area' },
        { id: 'window', name: '窗边', nameEn: 'Window View', keyProps: ['窗户', '窗帘'], keyPropsEn: ['window', 'curtains'], description: '窗边视角', descriptionEn: 'Window view' },
        { id: 'entrance', name: '入口', nameEn: 'Entrance View', keyProps: ['门', '玄关'], keyPropsEn: ['door', 'entrance'], description: '入口视角', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];
    case 'indoor_work':
      return [
        { id: 'study', name: '办公区', nameEn: 'Work Area', keyProps: ['书桌', '电脑'], keyPropsEn: ['desk', 'computer'], description: '办公区域', descriptionEn: 'Work area' },
        { id: 'window', name: '窗边', nameEn: 'Window View', keyProps: ['窗户'], keyPropsEn: ['window'], description: '窗边视角', descriptionEn: 'Window view' },
        { id: 'entrance', name: '入口', nameEn: 'Entrance View', keyProps: ['门'], keyPropsEn: ['door'], description: '入口视角', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];
    case 'indoor_public':
      return [
        { id: 'seating', name: '坐席区', nameEn: 'Seating Area', keyProps: [], keyPropsEn: [], description: '坐席区域', descriptionEn: 'Seating area' },
        { id: 'entrance', name: '入口', nameEn: 'Entrance View', keyProps: ['门'], keyPropsEn: ['door'], description: '入口视角', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];
    case 'ancient_indoor':
      return [
        { id: 'ancient_hall', name: '堂屋', nameEn: 'Main Hall', keyProps: ['太师椅', '案几'], keyPropsEn: ['taishi chair', 'table'], description: '堂屋视角', descriptionEn: 'Main hall view' },
        { id: 'ancient_table', name: '案几', nameEn: 'Ancient Table', keyProps: ['案几', '茶具'], keyPropsEn: ['table', 'tea set'], description: '案几视角', descriptionEn: 'Table view' },
        { id: 'ancient_screen', name: '屏风', nameEn: 'Screen View', keyProps: ['屏风', '帐幔'], keyPropsEn: ['screen', 'curtain'], description: '屏风视角', descriptionEn: 'Screen view' },
        { id: 'ancient_couch', name: '榻', nameEn: 'Ancient Couch', keyProps: ['榻', '软垫'], keyPropsEn: ['daybed', 'cushion'], description: '榻视角', descriptionEn: 'Couch view' },
        ...commonDefaults,
      ];
    case 'ancient_outdoor':
      return [
        { id: 'ancient_courtyard', name: '庭院', nameEn: 'Courtyard', keyProps: ['假山', '水池'], keyPropsEn: ['rockery', 'pond'], description: '庭院视角', descriptionEn: 'Courtyard view' },
        { id: 'ancient_pavilion', name: '亝子', nameEn: 'Pavilion', keyProps: ['亝', '石凳'], keyPropsEn: ['pavilion', 'stone bench'], description: '亝子视角', descriptionEn: 'Pavilion view' },
        { id: 'ancient_road', name: '官道', nameEn: 'Official Road', keyProps: ['官道'], keyPropsEn: ['road'], description: '官道视角', descriptionEn: 'Road view' },
        { id: 'ancient_gate', name: '城门', nameEn: 'City Gate', keyProps: ['城门', '城墙'], keyPropsEn: ['city gate', 'wall'], description: '城门视角', descriptionEn: 'City gate view' },
        ...commonDefaults,
      ];
    case 'ancient_vehicle':
      return [
        { id: 'ancient_sedan', name: '轿内', nameEn: 'Inside Sedan', keyProps: ['轿帘', '坐垫'], keyPropsEn: ['sedan curtain', 'cushion'], description: '轿内视角', descriptionEn: 'Inside sedan view' },
        { id: 'ancient_carriage', name: '车内', nameEn: 'Inside Carriage', keyProps: ['车篾', '坐垫'], keyPropsEn: ['canopy', 'cushion'], description: '车内视角', descriptionEn: 'Inside carriage view' },
        { id: 'ancient_boat', name: '船舱', nameEn: 'Boat Cabin', keyProps: ['船舱', '窗子'], keyPropsEn: ['cabin', 'window'], description: '船舱视角', descriptionEn: 'Boat cabin view' },
        { id: 'ancient_deck', name: '甲板', nameEn: 'Ship Deck', keyProps: ['甲板', '风帆'], keyPropsEn: ['deck', 'sail'], description: '甲板视角', descriptionEn: 'Deck view' },
        { id: 'ancient_horse', name: '马背', nameEn: 'On Horseback', keyProps: ['马', '马鞍'], keyPropsEn: ['horse', 'saddle'], description: '马背视角', descriptionEn: 'Horseback view' },
        ...commonDefaults,
      ];
    default:
      return commonDefaults.map((viewpoint) => ({
        ...viewpoint,
        keyProps: [...viewpoint.keyProps],
        keyPropsEn: [...viewpoint.keyPropsEn],
      }));
  }
}

export function isViewpointCompatibleWithEnvironment(
  config: ViewpointConfig,
  envType: SceneEnvironmentType,
): boolean {
  if (config.environments.length === 0 || envType === 'unknown') return true;
  return config.environments.includes(envType);
}
