import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/pages/HomePage.vue'),
    meta: { layout: 'BlankLayout', title: 'BUMBIS' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
] as RouteRecordRaw[]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  document.title = to.meta?.title?.toString() ?? 'new_project'
})

export default router
