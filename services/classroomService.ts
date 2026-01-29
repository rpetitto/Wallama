
import { ClassroomCourse, Wall } from '../types';

export const classroomService = {
  async listCourses(accessToken: string): Promise<ClassroomCourse[]> {
    try {
      const response = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&teacherId=me', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) throw new Error('Failed to fetch courses');
      const data = await response.json();
      return (data.courses || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        section: c.section,
        alternateLink: c.alternateLink
      }));
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async listStudentCourses(accessToken: string): Promise<ClassroomCourse[]> {
    try {
        const response = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&studentId=me', {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return (data.courses || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            section: c.section,
            alternateLink: c.alternateLink
        }));
    } catch (e) {
        return [];
    }
  },

  async shareWallToCourse(accessToken: string, courseId: string, wall: Wall): Promise<boolean> {
    try {
      const linkUrl = window.location.origin + window.location.pathname + "?wall=" + wall.joinCode;
      const message = `Join our class wall: ${wall.name}`;
      
      const response = await fetch(`https://classroom.googleapis.com/v1/courses/${courseId}/announcements`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: message,
          materials: [
            {
              link: {
                url: linkUrl,
                title: `The Wall: ${wall.name}`,
                thumbnailUrl: "https://placehold.co/200x200/4f46e5/ffffff?text=W"
              }
            }
          ],
          state: 'PUBLISHED'
        })
      });

      return response.ok;
    } catch (e) {
      console.error("Share error", e);
      return false;
    }
  },

  /**
   * Scans a student's active courses for announcements that contain links to The Wall.
   * This allows walls shared in Classroom to appear on the dashboard automatically.
   */
  async findWallsFromAnnouncements(accessToken: string): Promise<string[]> {
    try {
      const courses = await this.listStudentCourses(accessToken);
      const foundWallIds = new Set<string>();
      const appOrigin = window.location.origin;

      // Limit concurrent scans to avoid rate limits
      const promises = courses.slice(0, 5).map(async (course) => {
        try {
            const res = await fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/announcements?pageSize=5`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await res.json();
            if (data.announcements) {
                data.announcements.forEach((ann: any) => {
                    if (ann.materials) {
                        ann.materials.forEach((mat: any) => {
                            if (mat.link && mat.link.url && mat.link.url.includes(appOrigin)) {
                                try {
                                    const url = new URL(mat.link.url);
                                    const wallId = url.searchParams.get('wall');
                                    if (wallId) foundWallIds.add(wallId);
                                } catch(e) {}
                            }
                        });
                    }
                });
            }
        } catch (e) {
            // ignore individual course errors
        }
      });

      await Promise.all(promises);
      return Array.from(foundWallIds);
    } catch (e) {
      return [];
    }
  }
};
