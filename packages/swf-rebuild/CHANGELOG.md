# @seer-pet-anim/swf-rebuild

## 0.2.1

### Patch Changes

- 0d3089b: 修复普通序列的源内容帧带缩放或旋转时 SWF 导出失败的问题。只对需要保留的包装层变换要求纯平移，避免重复应用已展开到 bundle 顶点中的变换。

  支持不同序列在不同位置引用同一个待机子级，保留父层和子级的相对位移，修复 `ppets_290004950` 等资源的导出错误。

## 0.2.0

### Minor Changes

- fa3abf5: 支持 Lighten 材质
