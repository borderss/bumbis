import Icon from '@/components/icons/Icon.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

describe('Icon', () => {
  it('renders custom icons correctly', async () => {
    const wrapper = mount(Icon, { props: { name: 'cheveronLeft' } })
    wrapper.vm.$nextTick(() => {
      expect(wrapper.find('path').attributes('d')).toContain(
        'M15.41 16.58L10.83 12l4.58-4.59L14 6l-6 6l6 6z'
      )
    })
  })
  it('renders MDI icons correctly', () => {
    const wrapper = mount(Icon, { props: { name: 'mdiClock' } })
    wrapper.vm.$nextTick(() => {
      expect(wrapper.find('path').attributes('d')).toContain(
        'M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M16.2,16.2L11,13V7H12.5V12.2L17,14.9L16.2,16.2Z'
      )
    })
  })
  it('renders colors properly', () => {
    const wrapper = mount(Icon, { props: { name: 'cheveronLeft', fill: '#1a53ac' } })
    expect(wrapper.find('path').attributes('fill')).toBe('#1a53ac')
  })
  it('renders sizes properly', () => {
    const wrapper = mount(Icon, { props: { name: 'cheveronLeft', size: '32' } })
    expect(wrapper.find('svg').attributes('width')).toBe('32')
    expect(wrapper.find('svg').attributes('height')).toBe('32')
  })
})
