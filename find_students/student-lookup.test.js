/** @jest-environment jsdom */

const {
  normalizeAgeGroup,
  searchStudents,
  applyFilters,
  __setStudentsForTest,
} = require("./student-lookup.js");

describe("Student Lookup – Logic Tests", () => {
  const mockStudents = [
    {
      adminNo: "A001",
      firstName: "Jane",
      lastName: "Doe",
      class: "10A",
      grade: "10",
      gender: "F",
      agegroup: "13-15",
    },
    {
      adminNo: "A002",
      firstName: "John",
      lastName: "Smith",
      class: "10B",
      grade: "10",
      gender: "M",
      agegroup: "13-15",
    },
  ];

  beforeAll(() => {
    __setStudentsForTest(mockStudents);
  });

  test("normalizeAgeGroup decodes encoded values", () => {
    expect(normalizeAgeGroup("13%2D15")).toBe("13-15");
  });

  test("search by admin number returns exact match", () => {
    const result = searchStudents("a001", "admin");
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("Jane");
  });

  test("search by name supports partial match", () => {
    const result = searchStudents("smi", "name");
    expect(result[0].lastName).toBe("Smith");
  });

  test("applyFilters filters by grade and gender", () => {
    document.body.innerHTML = `
      <select id="filterGrade"><option value="10" selected></option></select>
      <select id="filterClass"></select>
      <select id="filterGender"><option value="F" selected></option></select>
      <select id="filterAgeGroup"></select>
    `;

    const result = applyFilters(mockStudents);
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe("Jane");
  });
});
